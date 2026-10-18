/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface Window {
  scribo?: import('./host/electron').ScriboBridge;
}
