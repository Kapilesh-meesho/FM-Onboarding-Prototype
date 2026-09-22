/* JSON -> ASCII-escaped -> raw deflate -> base64.
   Non-ASCII is escaped first because the sandbox has no TextDecoder: the
   inflated bytes are read back one char at a time, so they must all be < 256. */
const zlib = require("zlib");

function escapeNonAscii(s) {
  return s.replace(/[-￿]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

function toB64(json) {
  const ascii = escapeNonAscii(JSON.stringify(JSON.parse(json)));
  return zlib.deflateRawSync(Buffer.from(ascii, "latin1"), { level: 9 }).toString("base64");
}

module.exports = { toB64, escapeNonAscii };
