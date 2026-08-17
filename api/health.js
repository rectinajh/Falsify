module.exports = function handler(req, res) {
  res.status(200).json({ ok: true, model: process.env.GEMINI_MODEL ?? "gemini-3.6-flash" });
};
