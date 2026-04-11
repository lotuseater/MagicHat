function toIpv4FromMappedIpv6(addr) {
  if (!addr) {
    return null;
  }
  const mappedPrefix = "::ffff:";
  if (addr.toLowerCase().startsWith(mappedPrefix)) {
    return addr.slice(mappedPrefix.length);
  }
  return null;
}

export function normalizeRemoteAddress(rawAddress) {
  if (!rawAddress) {
    return "";
  }

  let normalized = rawAddress.trim();
  const zoneIdx = normalized.indexOf("%");
  if (zoneIdx >= 0) {
    normalized = normalized.slice(0, zoneIdx);
  }

  const mappedIpv4 = toIpv4FromMappedIpv6(normalized);
  if (mappedIpv4) {
    return mappedIpv4;
  }

  return normalized;
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = octets;
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}

function isPrivateIpv6(address) {
  const lowered = address.toLowerCase();
  if (lowered === "::1") {
    return true;
  }
  if (lowered.startsWith("fc") || lowered.startsWith("fd")) {
    return true;
  }
  if (lowered.startsWith("fe8") || lowered.startsWith("fe9") || lowered.startsWith("fea") || lowered.startsWith("feb")) {
    return true;
  }
  return false;
}

export function isLanAddress(address) {
  const normalized = normalizeRemoteAddress(address);
  if (!normalized) {
    return false;
  }

  if (normalized.includes(".")) {
    return isPrivateIpv4(normalized);
  }

  if (normalized.includes(":")) {
    return isPrivateIpv6(normalized);
  }

  return false;
}

export function enforceLanOnly(options = {}) {
  const {
    getRemoteAddress = (req) => req.socket?.remoteAddress || "",
  } = options;

  return (req, res, next) => {
    const remoteAddress = normalizeRemoteAddress(getRemoteAddress(req));
    if (!isLanAddress(remoteAddress)) {
      res.status(403).json({
        error: "forbidden_non_lan_client",
        remote_address: remoteAddress || null,
      });
      return;
    }
    next();
  };
}
