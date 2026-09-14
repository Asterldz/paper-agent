import type { NextConfig } from 'next';

const config: NextConfig = {
  // The hosted build remains unchanged. Desktop packaging emits a minimal,
  // self-contained local server that Electron can start without the source tree.
  output: process.env.PAPER_AGENT_DESKTOP_BUILD === '1' ? 'standalone' : undefined,
};

export default config;
