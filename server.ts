import path from "path";
import express from "express";
import app from "./api/index";

const PORT = 3000;

// Setup Vite middleware for development, serve static files for production
async function setupApp() {
  const isProd = process.env.NODE_ENV === "production" || 
                 (typeof __filename !== "undefined" && __filename.endsWith("server.cjs"));

  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, the bundled server.cjs resides inside dist/ along with static assets
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Jangra AI Backend listening on port ${PORT}`);
  });
}

setupApp();

export default app;
