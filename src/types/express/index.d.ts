import "express";

declare module "express-serve-static-core" {
  export interface Request {
    user?: any;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}
