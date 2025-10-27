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

const REGISTRATION_GUIDE_PROMPT = `You are an expert business registration consultant in India. Generate a comprehensive registration guide based on the business profile provided.

The guide MUST include:

1. **Recommended Entity Type** - Analyze the business and recommend the best entity type (Proprietorship, Partnership, LLP, Private Limited, etc.) with clear reasoning

2. **Company Name Suggestions** - Provide 3-4 suitable name suggestions based on the business description
   - Check name availability: https://www.mca.gov.in/mcafoportal/companyLLPNameAvailability.do
   - Trademark search: https://ipindiaservices.gov.in/publicsearch

3. **Complete Registration Timeline** - Day-by-day process:
   - Day 1-2: Apply for DSC (Digital Signature Certificate)
   - Day 3-4: Apply for DIN/DPIN
   - Day 5: Reserve company name (RUN form)
   - Day 6-15: File incorporation forms (SPICe+ for company/LLP)
   - Day 16: Receive Certificate of Incorporation
   - Day 17-20: Apply for PAN and TAN
   - Day 21-25: Open bank account
   - Day 26-30: GST registration (if turnover > ₹40 lakhs for services or ₹20 lakhs for goods)

4. **Required Documents Checklist**
   For Directors/Partners:
   - PAN Card (mandatory)
   - Aadhaar Card
   - Passport size photographs
   - Address proof
   - Bank statements (last 2 months)
   
   For Registered Office:
   - Rent agreement / NOC from owner
   - Utility bills (last 2 months)
   - Property documents

5. **Cost Breakdown** (based on entity type and location):
   - Government Fees
   - Professional Fees (optional)
   - DSC and other costs
   - Total estimated cost

6. **Official Government Portals**:
   - MCA Portal: https://www.mca.gov.in/mcafoportal/
   - DSC Application: https://www.mca.gov.in/MinistryV2/digitalsignature.html
   - Name Availability: https://www.mca.gov.in/mcafoportal/companyLLPNameAvailability.do
   - Trademark Search: https://ipindiaservices.gov.in/publicsearch

7. **Post-Registration Compliance**:
   - Annual ROC filings (Form AOC-4, MGT-7, etc.)
   - GST returns (monthly/quarterly)
   - Income tax returns
   - Board meetings and AGM requirements

8. **Brand Protection**:
   - Trademark registration steps
   - Domain name registration
   - Copyright for creative content

Format the response in clean markdown with proper headers, bullet points, and sections.`;

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

    // Get business profile from database if not provided
    let profile = businessProfile;
    if (!profile) {
      const { data: profileData } = await supabaseClient
        .from('business_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      profile = profileData || {};
    }

    // Build context for AI
    const contextInfo = `
Business Information:
- Company Name: ${profile.business_name || 'To be determined'}
- Description: ${profile.company_description || profile.business_description || 'Not provided'}
- Location: ${profile.location || 'India'}
- Business Type: ${profile.business_type || 'General'}
- Partners/Directors: ${JSON.stringify(profile.partners_info || profile.directors_partners || [])}

Generate a comprehensive registration guide for this business.`;

    // Call AI to generate the guide
    const fullContent = await callOpenRouterAPI(contextInfo);

    // Extract key points from the generated content
    const keyPoints = extractKeyPoints(fullContent);

    // Store in generated_documents table
    const { data: docData } = await supabaseClient
      .from('generated_documents')
      .insert({
        user_id: userId,
        session_id: sessionId,
        document_type: 'registration',
        document_title: 'Registration Guide',
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
    console.error('Error in registration-guide-guru function:', error);

    let errorMessage = 'Internal server error';
    let userMessage = 'Failed to generate registration guide. Please try again.';

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
            content: REGISTRATION_GUIDE_PROMPT
          },
          {
            role: 'user',
            content: contextInfo
          }
        ],
        temperature: 0.7,
        max_tokens: 3000
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
  
  // Extract entity type recommendation
  const entityMatch = content.match(/\*\*Recommended Entity Type\*\*[:\s]*([^\n]+)/i);
  if (entityMatch) {
    keyPoints.push(`Recommended: ${entityMatch[1].trim().substring(0, 100)}`);
  }
  
  // Extract timeline
  if (content.includes('Day 1') || content.includes('Timeline')) {
    keyPoints.push('Complete registration process: 25-30 days');
  }
  
  // Extract cost info
  const costMatch = content.match(/Total[:\s]*₹?([\d,]+)/i);
  if (costMatch) {
    keyPoints.push(`Estimated cost: ₹${costMatch[1]}`);
  } else {
    keyPoints.push('Estimated cost: ₹15,000 - ₹25,000');
  }
  
  // Standard key points
  keyPoints.push('Step-by-step registration timeline included');
  keyPoints.push('Complete documents checklist provided');
  keyPoints.push('Official government portal links included');
  keyPoints.push('Post-registration compliance guide included');
  
  return keyPoints.slice(0, 6);
}