import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, History, X, Star, Phone, Mail, Lightbulb, FileCheck } from 'lucide-react';
import { auth } from '../lib/auth';
import { submitRating, getMentorForService } from '../lib/rating';
import { createSession, getUserSessions, getSessionMessages, getServiceDisplayName, type UserSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import DocumentDashboard from './DocumentDashboard';
import DocumentViewer from './DocumentViewer';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  mentorCard?: {
    name: string;
    email: string;
    phone: string;
    expertise: string;
  };
  mentorCards?: Array<{
    name: string;
    email: string;
    phone: string;
    expertise: string;
    service: string;
  }>;
}

interface Document {
  id: string;
  type: 'registration' | 'branding' | 'compliance' | 'hr';
  title: string;
  keyPoints: string[];
  fullContent: string;
  pdfUrl?: string;
  status: 'generating' | 'completed' | 'failed';
}

interface SessionHistory {
  id: string;
  service: string;
  task: string;
  timestamp: Date;
  messages: Message[];
  icon: React.ComponentType<any>;
  status: 'completed' | 'in-progress' | 'escalated' | 'active' | 'abandoned';
  rating?: number;
}

interface ChatInterfaceProps {
  onNavigate?: (page: string) => void;
}

type ViewMode = 'chat' | 'dashboard' | 'document';
type FlowStage = 'initial' | 'questioning' | 'generating' | 'documents' | 'rating';

const QUESTIONS = [
  { id: 1, field: 'business_name', prompt: 'What is the company name or preferred company name?' },
  { id: 2, field: 'company_description', prompt: 'Please provide a brief description of the company or company website' },
  { id: 3, field: 'location', prompt: 'Which location will the business operate in?' },
  { id: 4, field: 'partners_info', prompt: 'Who will be the partners or directors? (How many and their roles?)' },
  { id: 5, field: 'color_preference', prompt: 'What color tone would you prefer for branding? (Earthy, Bright, Professional, etc.)' },
  { id: 6, field: 'style_preference', prompt: 'What style would you prefer? (Conservative/Classic, Modern/Contemporary, Expressive/Bold)' }
];

const ChatInterface = ({ onNavigate }: ChatInterfaceProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<SessionHistory[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedSession, setSelectedSession] = useState<SessionHistory | null>(null);
  const [sessionMessages, setSessionMessages] = useState<Message[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');

  // New state for sequential flow
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [flowStage, setFlowStage] = useState<FlowStage>('initial');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [businessProfile, setBusinessProfile] = useState<any>({});
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [awaitingRating, setAwaitingRating] = useState(false);
  const [ratingFeedback, setRatingFeedback] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    initializeChat();
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadSessionHistory();
    }
  }, [currentUser]);

  const initializeChat = async () => {
    try {
      const user = await auth.getCurrentUser();
      if (!user) {
        if (onNavigate) {
          onNavigate('login');
        }
        return;
      }

      setCurrentUser(user);

      // Show initial welcome message
      const welcomeMessage: Message = {
        id: '1',
        type: 'ai',
        content: 'Welcome to StartUP Companion! I\'m here to help you launch your business.\n\nPlease choose an option:\n\n1. Idea Tuning - My idea is not firmed up yet\n2. Confirmed Idea - I\'m ready to get my business documents\n\nJust type the number (1 or 2) to get started!',
        timestamp: new Date()
      };
      setMessages([welcomeMessage]);
    } catch (error) {
      console.error('Failed to initialize chat:', error);
      if (onNavigate) {
        onNavigate('login');
      }
    }
  };

  const loadSessionHistory = async () => {
    if (!currentUser) return;

    const sessions = await getUserSessions(currentUser.id);
    const historyData: SessionHistory[] = sessions.map(session => ({
      id: session.id,
      service: getServiceDisplayName(session.service_type),
      task: session.service_type,
      timestamp: new Date(session.created_at),
      messages: [],
      icon: FileCheck,
      status: session.status,
      rating: session.rating
    }));

    setSessionHistory(historyData);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const userInput = inputText;
    setInputText('');

    // Handle different stages
    if (flowStage === 'initial') {
      await handleInitialChoice(userInput);
    } else if (flowStage === 'questioning') {
      await handleQuestionResponse(userInput);
    } else if (flowStage === 'rating') {
      await handleRatingResponse(userInput);
    }
  };

  const handleInitialChoice = async (userInput: string) => {
    const choice = userInput.trim();

    if (choice === '1') {
      // Idea Tuning - placeholder
      const aiMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: 'Idea Tuning service will be available soon! This feature will help you refine and validate your business concept.\n\nFor now, if you have a confirmed idea, please type "2" to proceed with document generation.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
    } else if (choice === '2') {
      // Confirmed Idea - start questioning flow
      const session = await createSession(currentUser?.id, 'confirmed_idea_flow');
      if (session) {
        setCurrentSessionId(session);
      }

      setFlowStage('questioning');
      const aiMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: `Great! I'll ask you 6 quick questions to gather the information we need.\n\nQuestion 1 of 6:\n${QUESTIONS[0].prompt}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
    } else {
      const aiMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: 'Please type 1 for Idea Tuning or 2 for Confirmed Idea to proceed.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
    }
  };

  const handleQuestionResponse = async (userInput: string) => {
    const currentQuestion = QUESTIONS[currentQuestionIndex];

    // Store answer in business profile
    const updatedProfile = { ...businessProfile };

    if (currentQuestion.field === 'partners_info') {
      // Parse partners information
      updatedProfile[currentQuestion.field] = [{ info: userInput }];
    } else {
      updatedProfile[currentQuestion.field] = userInput;
    }

    setBusinessProfile(updatedProfile);

    // Save to database
    await updateBusinessProfile(updatedProfile);

    // Show confirmation and next question
    if (currentQuestionIndex < QUESTIONS.length - 1) {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);

      const aiMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: `Got it!\n\nQuestion ${nextIndex + 1} of 6:\n${QUESTIONS[nextIndex].prompt}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
    } else {
      // All questions answered - start generation
      setFlowStage('generating');
      const aiMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: 'Perfect! I have all the information I need.\n\nProcessing your information and generating your business documents...\n\nThis may take a few moments. Please wait.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);

      // Trigger document generation
      await generateAllDocuments();
    }
  };

  const updateBusinessProfile = async (profile: any) => {
    if (!currentUser) return;

    try {
      // Check if profile exists
      const { data: existingProfile } = await supabase
        .from('business_profiles')
        .select('id')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (existingProfile) {
        // Update existing profile
        await supabase
          .from('business_profiles')
          .update(profile)
          .eq('user_id', currentUser.id);
      } else {
        // Create new profile
        await supabase
          .from('business_profiles')
          .insert({
            user_id: currentUser.id,
            ...profile
          });
      }
    } catch (error) {
      console.error('Error updating business profile:', error);
    }
  };

  const generateAllDocuments = async () => {
    const documentTypes = ['registration', 'branding', 'compliance', 'hr'];
    const initialDocs: Document[] = documentTypes.map(type => ({
      id: `${type}-${Date.now()}`,
      type: type as any,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)} Guide`,
      keyPoints: [],
      fullContent: '',
      status: 'generating' as const
    }));

    setDocuments(initialDocs);
    setFlowStage('documents');
    setViewMode('dashboard');

    // Call edge functions for each document type
    const promises = documentTypes.map(type => generateDocument(type));
    await Promise.allSettled(promises);

    // Show completion message and ask for rating
    setTimeout(() => {
      setFlowStage('rating');
      setViewMode('chat');

      const ratingMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: '🎉 All your business documents have been generated!\n\nYou can view them in the document dashboard.\n\nHow would you rate your experience?\n\nPlease type a number from 1-5:\n\n1 ⭐ - Poor\n2 ⭐⭐ - Fair\n3 ⭐⭐⭐ - Good\n4 ⭐⭐⭐⭐ - Very Good\n5 ⭐⭐⭐⭐⭐ - Excellent',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, ratingMessage]);
      setAwaitingRating(true);
    }, 3000);
  };

  const generateDocument = async (type: string) => {
    try {
      let functionName = '';
      if (type === 'registration') functionName = 'registration-guide-guru';
      else if (type === 'branding') functionName = 'branding-guide-guru';
      else if (type === 'compliance') functionName = 'compliance-guide-guru';
      else if (type === 'hr') functionName = 'hr-guide-guru';

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
      const headers = {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: 'generate_document',
          sessionId: currentSessionId,
          userId: currentUser.id,
          businessProfile: businessProfile
        })
      });

      if (response.ok) {
        const result = await response.json();

        // Check if the response contains an error
        if (result.error || result.userMessage) {
          console.error(`Error from edge function for ${type}:`, result);
          setDocuments(prev => prev.map(doc =>
            doc.type === type ? { ...doc, status: 'failed' as const } : doc
          ));
          return;
        }

        // Validate that we have actual content
        const fullContent = result.fullContent || result.response || '';
        if (!fullContent || fullContent.length < 100) {
          console.error(`Invalid or empty content received for ${type} document`);
          setDocuments(prev => prev.map(doc =>
            doc.type === type ? { ...doc, status: 'failed' as const } : doc
          ));
          return;
        }

        // Update document status with valid content
        setDocuments(prev => prev.map(doc =>
          doc.type === type ? {
            ...doc,
            status: 'completed' as const,
            keyPoints: result.keyPoints || [],
            fullContent: fullContent,
            pdfUrl: result.pdfUrl
          } : doc
        ));
      } else {
        // Mark as failed for non-200 responses
        const errorData = await response.json().catch(() => ({}));
        console.error(`Failed to generate ${type} document:`, errorData);
        setDocuments(prev => prev.map(doc =>
          doc.type === type ? { ...doc, status: 'failed' as const } : doc
        ));
      }
    } catch (error) {
      console.error(`Error generating ${type} document:`, error);
      setDocuments(prev => prev.map(doc =>
        doc.type === type ? { ...doc, status: 'failed' as const } : doc
      ));
    }
  };

  const handleRatingResponse = async (userInput: string) => {
    const rating = parseInt(userInput.trim());

    if (rating >= 1 && rating <= 5) {
      setAwaitingRating(false);

      // Store rating
      await submitRating({
        user_id: currentUser?.id,
        session_id: currentSessionId,
        service_type: 'confirmed_idea_flow',
        rating: rating
      });

      const thankYouMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: `Thank you for your ${rating}-star rating! ${rating >= 4 ? '🎉 We\'re glad you had a great experience!' : ''}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, thankYouMessage]);

      if (rating <= 3) {
        setTimeout(() => {
          const feedbackMessage: Message = {
            id: (Date.now() + 1).toString(),
            type: 'ai',
            content: 'We\'re sorry to hear that. Could you briefly tell us what went wrong or what we could improve? Your feedback helps us serve you better.',
            timestamp: new Date()
          };
          setMessages(prev => [...prev, feedbackMessage]);
          setRatingFeedback('awaiting');
        }, 1000);
      } else {
        setTimeout(() => {
          const finalMessage: Message = {
            id: (Date.now() + 1).toString(),
            type: 'ai',
            content: 'All your documents are available in the dashboard. You can view or download them anytime. Thank you for using StartUP Companion!',
            timestamp: new Date()
          };
          setMessages(prev => [...prev, finalMessage]);
        }, 1500);
      }
    } else if (ratingFeedback === 'awaiting') {
      // Handle feedback
      setRatingFeedback('');

      const feedbackThankYou: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: 'Thank you for your feedback. Let us connect you with our expert mentors who can provide personalized guidance for each area of your business.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, feedbackThankYou]);

      // Get mentors for each service type
      const serviceTypes = ['registration', 'branding', 'compliance', 'hr'];
      const mentorPromises = serviceTypes.map(type => getMentorForService(type));
      const mentors = await Promise.all(mentorPromises);

      const mentorCards = mentors
        .filter(mentor => mentor !== null)
        .map((mentor, index) => ({
          name: mentor!.name,
          email: mentor!.email,
          phone: mentor!.phone || '',
          expertise: mentor!.specialization.join(', '),
          service: serviceTypes[index].charAt(0).toUpperCase() + serviceTypes[index].slice(1)
        }));

      if (mentorCards.length > 0) {
        setTimeout(() => {
          const mentorMessage: Message = {
            id: (Date.now() + 1).toString(),
            type: 'ai',
            content: '📞 Your Recommended Mentors',
            timestamp: new Date(),
            mentorCards: mentorCards
          };
          setMessages(prev => [...prev, mentorMessage]);
        }, 1500);
      }
    } else {
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: 'Please provide a valid rating between 1 and 5.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  const handleViewDocument = (doc: Document) => {
    setSelectedDocument(doc);
    setViewMode('document');
  };

  const handleDownloadPdf = (doc: Document) => {
    if (doc.pdfUrl) {
      window.open(doc.pdfUrl, '_blank');
    }
  };

  const handleBackToDashboard = () => {
    setSelectedDocument(null);
    setViewMode('dashboard');
  };

  const handleSessionClick = async (session: SessionHistory) => {
    try {
      const messages = await getSessionMessages(session.id);
      const formattedMessages: Message[] = messages.map(msg => ({
        id: msg.id,
        type: msg.message_type === 'user' ? 'user' : 'ai',
        content: msg.content,
        timestamp: new Date(msg.created_at)
      }));

      setSessionMessages(formattedMessages);
      setSelectedSession(session);
    } catch (error) {
      console.error('Failed to load session messages:', error);
    }
  };

  const handleBackToHistory = () => {
    setSelectedSession(null);
    setSessionMessages([]);
  };

  const handleLogout = async () => {
    await auth.signOut();
    if (onNavigate) {
      onNavigate('home');
    }
  };

  const renderMainContent = () => {
    if (viewMode === 'dashboard') {
      return (
        <DocumentDashboard
          documents={documents}
          onViewDocument={handleViewDocument}
          onDownloadPdf={handleDownloadPdf}
          onBackToChat={() => setViewMode('chat')}
        />
      );
    }

    if (viewMode === 'document' && selectedDocument) {
      return (
        <DocumentViewer
          document={selectedDocument}
          onBack={handleBackToDashboard}
          onDownloadPdf={() => handleDownloadPdf(selectedDocument)}
        />
      );
    }

    // Chat view
    return (
      <div className="flex flex-col h-full">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-3xl flex ${message.type === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start space-x-3`}>
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  message.type === 'user' ? 'bg-blue-600' : 'bg-gray-700'
                }`}>
                  {message.type === 'user' ?
                    <User className="h-4 w-4" /> :
                    <Bot className="h-4 w-4" />
                  }
                </div>

                {/* Message Content */}
                <div className={`rounded-lg p-4 ${
                  message.type === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-100'
                }`}>
                  <p className="whitespace-pre-line">{message.content}</p>

                  {/* Single Mentor Card */}
                  {message.mentorCard && (
                    <div className="mt-3 bg-gray-700 rounded-lg p-3">
                      <h4 className="font-semibold text-white mb-2">Connect with Expert</h4>
                      <div className="space-y-2 text-sm">
                        <p className="font-medium">{message.mentorCard.name}</p>
                        <p className="text-gray-300">{message.mentorCard.expertise}</p>
                        <div className="flex items-center space-x-4">
                          <a href={`mailto:${message.mentorCard.email}`} className="flex items-center space-x-1 text-blue-400 hover:text-blue-300">
                            <Mail className="h-4 w-4" />
                            <span>Email</span>
                          </a>
                          <a href={`tel:${message.mentorCard.phone}`} className="flex items-center space-x-1 text-blue-400 hover:text-blue-300">
                            <Phone className="h-4 w-4" />
                            <span>Call</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Multiple Mentor Cards */}
                  {message.mentorCards && message.mentorCards.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {message.mentorCards.map((mentor, index) => (
                        <div key={index} className="bg-gray-700 rounded-lg p-3">
                          <h4 className="font-semibold text-white mb-2">{mentor.service} Expert</h4>
                          <div className="space-y-2 text-sm">
                            <p className="font-medium">{mentor.name}</p>
                            <p className="text-gray-300">{mentor.expertise}</p>
                            <div className="flex items-center space-x-4">
                              <a href={`mailto:${mentor.email}`} className="flex items-center space-x-1 text-blue-400 hover:text-blue-300">
                                <Mail className="h-4 w-4" />
                                <span>Email</span>
                              </a>
                              {mentor.phone && (
                                <a href={`tel:${mentor.phone}`} className="flex items-center space-x-1 text-blue-400 hover:text-blue-300">
                                  <Phone className="h-4 w-4" />
                                  <span>Call</span>
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Timestamp */}
                  <p className="text-xs opacity-60 mt-2">
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-800 p-4">
          <div className="flex items-center space-x-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type your message..."
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={handleSendMessage}
              className="bg-blue-600 hover:bg-blue-700 p-2 rounded-lg transition-colors duration-200"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="bg-black/90 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <img src="/Logo Gear.png" alt="StartUP Companion Logo" className="h-8 w-8" />
              <span className="text-xl font-bold text-white">StartUP Companion</span>
            </div>

            <div className="flex items-center space-x-4">
              <button
                onClick={() => {
                  if (!showHistory && currentUser) {
                    loadSessionHistory();
                  }
                  setShowHistory(!showHistory);
                }}
                className="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors duration-200"
              >
                <History className="h-5 w-5" />
                <span>History</span>
              </button>

              {flowStage === 'documents' || flowStage === 'rating' ? (
                <button
                  onClick={() => setViewMode('dashboard')}
                  className="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors duration-200"
                >
                  <FileCheck className="h-5 w-5" />
                  <span>Documents</span>
                </button>
              ) : null}

              <button
                onClick={handleLogout}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors duration-200"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* History Sidebar */}
        {showHistory && (
          <div className="w-80 border-r border-gray-800 bg-gray-900/50 flex flex-col">
            {!selectedSession ? (
              <>
                <div className="p-4 border-b border-gray-800">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Session History</h3>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="text-gray-400 hover:text-white"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-3 overflow-y-auto">
                  {sessionHistory.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">No previous sessions</p>
                  ) : (
                    sessionHistory.map((session) => (
                      <div
                        key={session.id}
                        onClick={() => handleSessionClick(session)}
                        className="bg-gray-800 rounded-lg p-3 hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
                      >
                        <div className="flex items-center space-x-3">
                          <session.icon className="h-5 w-5 text-blue-500" />
                          <div className="flex-1">
                            <p className="font-medium text-sm">{session.service}</p>
                            <p className="text-xs text-gray-500">
                              {session.timestamp.toLocaleDateString()} at {session.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            {session.rating && (
                              <div className="flex items-center space-x-1 mt-1">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-3 w-3 ${i < session.rating! ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
                                  />
                                ))}
                                <span className="text-xs text-gray-400 ml-1">({session.rating}/5)</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="p-4 border-b border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <button
                      onClick={handleBackToHistory}
                      className="text-blue-500 hover:text-blue-400 flex items-center space-x-1"
                    >
                      <span className="text-lg">←</span>
                      <span>Back</span>
                    </button>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="text-gray-400 hover:text-white"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {sessionMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] ${msg.type === 'user' ? 'bg-blue-600' : 'bg-gray-800'} rounded-lg p-3`}>
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {renderMainContent()}
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-black border-t border-gray-800 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center space-x-2">
            <img src="/Logo Gear.png" alt="StartUP Companion Logo" className="h-6 w-6" />
            <span className="text-lg font-bold text-white">StartUP Companion</span>
          </div>
          <p className="text-center text-gray-400 text-sm mt-2">
            Launch your business in personalized way in 30 minutes
          </p>
        </div>
      </footer>
    </div>
  );
};

export default ChatInterface;
