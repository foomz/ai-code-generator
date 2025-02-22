import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export default function Terminal({ process }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const inputWriterRef = useRef(null);

  useEffect(() => {
    if (!terminalRef.current || !process) return;

    // Initialize xterm.js
    const terminal = new XTerm({
      cursorBlink: true,
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
      },
      rows: 24,
      cols: 80
    });
    
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    
    terminal.open(terminalRef.current);
    
    // Initial fit
    try {
      fitAddon.fit();
    } catch (e) {
      console.error('Failed to fit terminal:', e);
    }

    // Handle window resize
    const handleResize = () => {
      try {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
      } catch (e) {
        console.error('Failed to resize terminal:', e);
      }
    };

    window.addEventListener('resize', handleResize);

    // Set up input writer
    const encoder = new TextEncoder();
    let inputWriter = null;

    const setupWriter = async () => {
      const writer = process.input.getWriter();
      inputWriterRef.current = writer;
      return writer;
    };

    // Handle process output
    process.output.pipeTo(
      new WritableStream({
        write(data) {
          if (xtermRef.current) {
            xtermRef.current.write(data);
          }
        }
      })
    );

    // Handle user input
    terminal.onData(async (data) => {
      if (!inputWriter) {
        inputWriter = await setupWriter();
      }
      
      try {
        await inputWriter.write(encoder.encode(data));
      } catch (error) {
        console.error('Failed to write to terminal:', error);
      }
    });

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (xtermRef.current) {
        xtermRef.current.dispose();
      }
      if (inputWriterRef.current) {
        try {
          inputWriterRef.current.releaseLock();
        } catch (e) {
          console.error('Failed to release input writer lock:', e);
        }
      }
    };
  }, [process]);

  return (
    <div ref={terminalRef} className="h-48 rounded-lg overflow-hidden" />
  );
}