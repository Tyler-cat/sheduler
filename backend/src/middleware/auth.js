const HTTP_STATUS = {
  unauthorized: 401,
  forbidden: 403
};

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    res.status(HTTP_STATUS.unauthorized).json({ message: 'Authentication required' });
    return;
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user) {
      res.status(HTTP_STATUS.unauthorized).json({ message: 'Authentication required' });
      return;
    }
    if (!roles.includes(user.globalRole)) {
      res.status(HTTP_STATUS.forbidden).json({ message: `Forbidden for role ${user.globalRole}` });
      return;
    }
    next();
  };
}

function injectOrgScope(options = {}) {
  const { setOrgContext } = options;
  return async (req, _res, next) => {
    const orgIds = (req.session && req.session.user && req.session.user.orgIds) || [];
    req.orgIds = orgIds;
    if (typeof setOrgContext === 'function') {
      await setOrgContext(orgIds, req);
    }
    next();
  };
}

function hasCapability(req, capability) {
  const capabilities = req.session && req.session.user && req.session.user.capabilities;
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

export { hasCapability, injectOrgScope, requireAuth, requireRole };
