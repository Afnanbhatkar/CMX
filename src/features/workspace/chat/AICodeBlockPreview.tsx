"use client";

import { useEffect, useRef } from "react";

interface AICodeBlockPreviewProps {
  code: string;
  language: string;
}

export function AICodeBlockPreview({ code, language }: AICodeBlockPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;

    // Clear previous content
    iframeDoc.open();
    iframeDoc.write("<!DOCTYPE html>");
    iframeDoc.write("<html>");
    iframeDoc.write("<head>");
    iframeDoc.write("<style>body { margin: 0; font-family: monospace; }</style>");
    
    // Add language-specific styles
    if (language === "css") {
      iframeDoc.write("<style>" + code + "</style>");
    }
    
    iframeDoc.write("</head>");
    iframeDoc.write("<body>");
    
    if (language === "html") {
      iframeDoc.write(code);
    } else if (language === "javascript" || language === "jsx") {
      iframeDoc.write("<script>" + code + "</script>");
    } else {
      // For other languages, display as plain text
      iframeDoc.write("<pre>" + code + "</pre>");
    }
    
    iframeDoc.write("</body>");
    iframeDoc.write("</html>");
    iframeDoc.close();
  }, [code, language]);

  return (
    <div className="relative w-full h-64 border rounded-lg overflow-hidden bg-muted">
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        className="w-full h-full"
        title={`Preview for ${language}`}
      />
    </div>
  );
}