// src/types/custom-session.d.ts

// Important: Re-declare the 'express-session' module directly here
// This often forces the merge, especially if there's a bundling/resolution quirk
declare module 'express-session' {
  interface SessionData {
    views?: number; 
    userId?: string;
    isGuest?: boolean;
  }
}

// Also, explicitly augment the Express Request object for maximum robustness
// This is often more reliable for properties on req.session
import { Request } from 'express'; // Import Request to extend it
import { Session, SessionData } from 'express-session'; // Import basic Session/SessionData types

declare global {
  namespace Express {
    interface Request {
      session: Session & Partial<SessionData> & {
        views?: number;
        userId?: string;
        isGuest?: boolean;
      };
      cartIdentifier: string;
    }
  }
}