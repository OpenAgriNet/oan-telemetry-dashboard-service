function getUserDisplayName(user) {
  if (!user) {
    return null;
  }

  const candidates = [user.preferred_username, user.name, user.email];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getUserId(user) {
  if (!user) {
    return null;
  }

  return user.sub || user.preferred_username || user.email || null;
}

module.exports = {
  getUserDisplayName,
  getUserId,
};
