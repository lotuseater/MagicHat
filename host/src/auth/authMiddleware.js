import { extractBearerToken } from "./pairingManager.js";

export function buildAuthMiddleware(pairingManager, options = {}) {
  const {
    isPublicRoute = (req) => req.path === "/pairing/session",
  } = options;

  return (req, res, next) => {
    if (isPublicRoute(req)) {
      next();
      return;
    }

    const token = extractBearerToken(req.headers.authorization);
    const session = pairingManager.validateToken(token);

    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    req.auth = session;
    next();
  };
}
