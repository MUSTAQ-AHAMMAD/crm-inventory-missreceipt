/**
 * Simple request/response logger middleware.
 * Logs method, URL, status code and elapsed time to the console.
 */

function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const elapsed = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${elapsed}ms`
    );
  });

  next();
}

module.exports = { requestLogger };
