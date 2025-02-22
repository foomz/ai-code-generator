import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import Editor from "@monaco-editor/react";
import Terminal from '../components/Terminal';
import { mountAndStartProject } from '../lib/webcontainer';

const OPENROUTER_API_KEY = 'your api key';

export default function Dashboard() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generatedCode, setGeneratedCode] = useState('// Your generated code will appear here');
  const [isGenerating, setIsGenerating] = useState(false);
  const [devProcess, setDevProcess] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const webcontainerRef = useRef(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [executionError, setExecutionError] = useState(null);

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      navigate('/login');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const createConversation = async (title) => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .insert([{ 
          user_id: session.user.id, 
          title: title || 'New Conversation'
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  };

  const saveMessage = async (conversationId, role, content) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert([{ 
          conversation_id: conversationId, 
          role, 
          content 
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error saving message:', error);
      throw error;
    }
  };

  const saveGeneratedCode = async (conversationId, messageId, code, language) => {
    try {
      const { error } = await supabase
        .from('generated_code')
        .insert([{
          conversation_id: conversationId,
          message_id: messageId,
          code,
          language: language || 'javascript'
        }]);

      if (error) throw error;
    } catch (error) {
      console.error('Error saving generated code:', error);
      throw error;
    }
  };

  const parseCodeBlocks = (content) => {
    const files = {};
    const regex = /```([\w.-]+)\n([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const [, filename, code] = match;
      if (filename && code) {
        // Handle special cases for certain file types
        if (filename === 'jsx' || filename === 'tsx' || filename === 'react') {
          files['src/App.jsx'] = code.trim();
        } else if (filename === 'css') {
          files['src/index.css'] = code.trim();
        } else {
          // Remove file extension from the filename if it's used as a language identifier
          const cleanFilename = filename.includes('.') ? filename : `src/${filename}.jsx`;
          files[cleanFilename] = code.trim();
        }
      }
    }

    // Ensure we have the main entry point
    if (!files['src/main.jsx']) {
      files['src/main.jsx'] = `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`;
    }

    // Ensure we have a basic CSS file
    if (!files['src/index.css']) {
      files['src/index.css'] = `
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
}`;
    }

    return files;
  };

  const executeCode = async (generatedContent) => {
    setIsExecuting(true);
    setExecutionError(null);
    try {
      // Parse the generated code to extract files
      const files = parseCodeBlocks(generatedContent);

      if (Object.keys(files).length === 0) {
        throw new Error('No valid code blocks found in the generated content');
      }

      // Cleanup previous instance
      if (webcontainerRef.current) {
        try {
          await webcontainerRef.current.teardown();
          webcontainerRef.current = null;
        } catch (error) {
          console.error('Error during cleanup:', error);
        }
      }

      // Mount and start the project
      const { webcontainer, devProcess: process, serverUrl } = await mountAndStartProject(files);
      webcontainerRef.current = webcontainer;
      setDevProcess(process);
      setPreviewUrl(serverUrl);
      
      toast.success('Project started successfully!');
    } catch (error) {
      console.error('Error executing code:', error);
      setExecutionError(error.message);
      toast.error(`Failed to execute code: ${error.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const generateCode = async () => {
    if (!prompt.trim()) {
      toast.error('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    setExecutionError(null);
    let conversation;

    try {
      // Create a new conversation
      conversation = await createConversation(prompt.substring(0, 50) + '...');
      setCurrentConversation(conversation);

      // Save user message
      const userMessage = await saveMessage(conversation.id, 'user', prompt);

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": window.location.href,
          "X-Title": "AI Code Generator",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          "model": "deepseek/deepseek-r1-distill-llama-70b:free",
          "messages": [
            {
              "role": "system",
              "content": "You are an expert programmer. Generate clean, well-documented code based on the user's requirements. Focus on React and Node.js. Always wrap code blocks in triple backticks with the filename, like: ```App.jsx\ncode here```. Include all necessary files for a complete React application."
            },
            {
              "role": "user",
              "content": prompt
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response format from API');
      }

      const generatedContent = data.choices[0].message.content;
      setGeneratedCode(generatedContent);

      // Save assistant message
      const assistantMessage = await saveMessage(conversation.id, 'assistant', generatedContent);

      // Save generated code
      await saveGeneratedCode(
        conversation.id,
        assistantMessage.id,
        generatedContent,
        'javascript'
      );

      toast.success('Code generated successfully!');

      // Automatically execute the generated code
      await executeCode(generatedContent);
    } catch (error) {
      console.error('Error generating code:', error);
      
      // Clean up the conversation if it was created but later steps failed
      if (conversation?.id) {
        try {
          await supabase
            .from('conversations')
            .delete()
            .match({ id: conversation.id });
        } catch (cleanupError) {
          console.error('Error cleaning up conversation:', cleanupError);
        }
      }

      toast.error(error.message || 'Failed to generate code. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Cleanup WebContainer on unmount
  useEffect(() => {
    return () => {
      if (webcontainerRef.current) {
        webcontainerRef.current.teardown().catch(console.error);
      }
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen bg-gray-900"
    >
      <nav className="bg-gray-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <motion.div 
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex items-center"
            >
              <h1 className="text-xl font-bold text-white">AI Code Generator</h1>
            </motion.div>
            <motion.div 
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex items-center"
            >
              <span className="text-gray-300 mr-4">{session?.user?.email}</span>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400 }}
                onClick={handleSignOut}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Sign out
              </motion.button>
            </motion.div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-gray-800 rounded-lg shadow-xl p-6"
        >
          <div className="mb-6">
            <label htmlFor="prompt" className="block text-sm font-medium text-gray-300 mb-2">
              Enter your requirements
            </label>
            <div className="flex gap-4">
              <motion.textarea
                whileFocus={{ scale: 1.01 }}
                id="prompt"
                rows="3"
                className="block w-full rounded-lg border border-gray-600 bg-gray-700 text-white placeholder-gray-400 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2.5"
                placeholder="e.g., Build a to-do list app with authentication"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                onClick={generateCode}
                disabled={isGenerating || isExecuting}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 min-w-[120px] h-fit"
              >
                {isGenerating ? 'Generating...' : isExecuting ? 'Executing...' : 'Generate'}
              </motion.button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="bg-gray-900 rounded-lg overflow-hidden"
            >
              <Editor
                height="60vh"
                defaultLanguage="javascript"
                theme="vs-dark"
                value={generatedCode}
                options={{
                  readOnly: false,
                  minimap: { enabled: true },
                  fontSize: 14,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
                onChange={(value) => setGeneratedCode(value)}
              />
            </motion.div>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="bg-gray-900 rounded-lg overflow-hidden"
            >
              <div className="h-[60vh] flex flex-col">
                <div className="flex-1 overflow-hidden">
                  {executionError ? (
                    <div className="w-full h-full flex items-center justify-center text-red-400 p-4 text-center">
                      {executionError}
                    </div>
                  ) : previewUrl ? (
                    <iframe
                      className="w-full h-full bg-white"
                      src={previewUrl}
                      title="Preview"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      Preview will appear here after code generation
                    </div>
                  )}
                </div>
                <div className="h-48 border-t border-gray-700">
                  {devProcess && <Terminal process={devProcess} />}
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </main>
    </motion.div>
  );
}