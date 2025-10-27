import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestPayload {
  message: string;
  sessionId: string;
  userId: string;
  businessProfile?: any;
}

const HR_GUIDE_PROMPT = `You are an expert HR consultant specializing in startup and SME human resources management in India. Generate a comprehensive HR setup guide based on the business profile provided.

The guide MUST include:

1. **Organizational Structure**
   - Recommended org chart for the business size
   - Key roles and responsibilities
   - Reporting structure
   - Hiring roadmap (Phase 1, 2, 3)

2. **Employment Documentation**
   - Offer letter template structure
   - Employment agreement key clauses
   - Appointment letter format
   - Probation period guidelines
   - Notice period recommendations
   - Non-disclosure agreement (NDA)
   - Non-compete clauses

3. **HR Policies**
   - Leave policy (casual, sick, earned leave)
   - Work hours and attendance policy
   - Remote work policy
   - Code of conduct
   - Anti-harassment policy
   - Grievance redressal mechanism
   - Performance review process
   - Disciplinary action policy

4. **Compensation and Benefits**
   - Salary structure components (basic, HRA, special allowance)
   - Salary benchmarking guidelines
   - Variable pay and bonus structure
   - Reimbursement policies (travel, medical, internet)
   - Insurance benefits (health, accidental)
   - Retirement benefits (PF, gratuity)

5. **Payroll Management**
   - Payroll processing timeline
   - Statutory deductions (PF, PT, TDS)
   - Payslip format
   - Form 16 and tax declaration
   - Reimbursement processing
   - Payroll software recommendations

6. **Onboarding Process**
   - Pre-joining checklist
   - Day 1 onboarding agenda
   - First week orientation plan
   - 30-60-90 day goals
   - Buddy/mentor assignment
   - Training and development plan

7. **Performance Management**
   - Goal setting framework (OKRs/KPIs)
   - Performance review cycle
   - Feedback mechanisms
   - Promotion criteria
   - Performance improvement plans

8. **Employee Engagement**
   - Team building activities
   - Recognition and rewards program
   - Communication channels
   - Employee satisfaction surveys
   - Exit interview process

9. **Legal Compliance**
   - Minimum wages act
   - Payment of wages act
   - Gratuity act (after 5 years)
   - Maternity benefit act
   - Sexual harassment prevention (POSH Act)
   - Contract labor regulations

10. **HR Technology Stack**
    - HRMS software recommendations
    - Attendance and leave management tools
    - Payroll software options
    - Recruitment platforms
    - Employee engagement tools

11. **Cost Planning**
    - Per-employee cost breakdown
    - HR software costs
    - Recruitment costs
    - Training and development budget
    - Total HR budget estimation

Format the response in clean markdown with proper headers, templates, checklists, and actionable guidelines. Make it practical and ready-to-implement.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { message, sessionId, userId, businessProfile }: RequestPayload = await req.json();

    let profile = businessProfile;
    if (!profile) {
      const { data: profileData } = await supabaseClient
        .from('business_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      profile = profileData || {};
    }

    const contextInfo = `
Business Information:
- Company Name: ${profile.business_name || 'Company'}
- Business Type: ${profile.business_type || 'General'}
- Location: ${profile.location || 'India'}
- Team Size: ${JSON.stringify(profile.partners_info || profile.directors_partners || [])}

Generate a comprehensive HR setup guide for this business covering policies, documentation, and compliance.`;

    const fullContent = await callOpenRouterAPI(contextInfo);
    const keyPoints = extractKeyPoints(fullContent);

    const { data: docData } = await supabaseClient
      .from('generated_documents')
      .insert({
        user_id: userId,
        session_id: sessionId,
        document_type: 'hr',
        document_title: 'HR Setup Guide',
        key_points: keyPoints,
        full_content: fullContent,
        generation_status: 'completed'
      })
      .select()
      .single();

    return new Response(
      JSON.stringify({
        response: fullContent,
        keyPoints: keyPoints,
        fullContent: fullContent,
        documentId: docData?.id
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in hr-guide-guru function:', error);

    let errorMessage = 'Internal server error';
    let userMessage = 'Failed to generate HR guide. Please try again.';

    if (error.message === 'API_KEY_NOT_CONFIGURED') {
      errorMessage = 'OpenRouter API key not configured';
      userMessage = 'Configuration error: API key missing. Please contact support.';
    } else if (error.message?.startsWith('API_ERROR')) {
      errorMessage = error.message;
      userMessage = 'AI service temporarily unavailable. Please try again in a moment.';
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        userMessage: userMessage,
        details: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function callOpenRouterAPI(contextInfo: string): Promise<string> {
  const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

  if (!openRouterApiKey) {
    console.error('OPENROUTER_API_KEY not configured in edge function environment');
    throw new Error('API_KEY_NOT_CONFIGURED');
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://startup-companion.app',
        'X-Title': 'StartUP Companion'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: HR_GUIDE_PROMPT
          },
          {
            role: 'user',
            content: contextInfo
          }
        ],
        temperature: 0.7,
        max_tokens: 3500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenRouter API error ${response.status}:`, errorText);
      throw new Error(`API_ERROR: ${response.status}`);
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
      console.error('Invalid response structure from OpenRouter API:', data);
      throw new Error('INVALID_API_RESPONSE');
    }

    return data.choices[0].message.content;

  } catch (error) {
    console.error('Error calling OpenRouter API:', error);
    throw error;
  }
}

function extractKeyPoints(content: string): string[] {
  const keyPoints: string[] = [];
  
  keyPoints.push('Complete employment documentation templates');
  keyPoints.push('Essential HR policies (leave, attendance, code of conduct)');
  keyPoints.push('Salary structure and compensation guidelines');
  keyPoints.push('Payroll processing and statutory compliance');
  keyPoints.push('Onboarding and performance management frameworks');
  keyPoints.push('HR technology and tools recommendations');
  
  return keyPoints;
}