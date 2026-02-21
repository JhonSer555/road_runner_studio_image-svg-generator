/**
 * Road Runner Studio - Dev Console Art
 * Adds a stylish splash screen to the browser console.
 */

export const initConsoleSVGArt = (): void => {
  if (typeof window === "undefined") return;
  if ((window as any).__RR_CONSOLE_SVG__) return;
  (window as any).__RR_CONSOLE_SVG__ = true;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600"><rect width="100%" height="100%" fill="#000000" id="layer-rect-0-1"/><rect width="100%" height="100%" fill="#000000" id="layer-rect-0" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"/><rect id="svg-background-rect" width="100%" height="100%" fill="#000000" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"/>
  <style>
    @keyframes dash {
      to { stroke-dashoffset: 0; }
    }
    @keyframes glowPulse {
      0%, 100% { filter: none; opacity: 1; }
      50% { filter: none; opacity: 0.8; }
    }
    @keyframes fillFlow {
      0% { stop-color: #ff0095; }
      50% { stop-color: #ffae00; }
      100% { stop-color: #ff0095; }
    }
    @keyframes moveLines {
      0% { transform: translateX(-10px); opacity: 0.5; }
      50% { transform: translateX(10px); opacity: 1; }
      100% { transform: translateX(-10px); opacity: 0.5; }
    }
    @keyframes rotateCircle {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .main-text {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-weight: 900;
      font-style: italic;
      font-size: 110px;
      letter-spacing: 2px;
    }
    .sigma-text {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-weight: 300;
      font-size: 55px;
    }
    .trace {
      stroke-dasharray: 1000;
      stroke-dashoffset: 1000;
      animation: dash 5s linear infinite;
    }
    .glow-anim {
      animation: glowPulse 3s ease-in-out infinite;
    }
  </style>

  <defs>
    <!-- Basic Neon Glow -->
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
    
    <!-- Stronger Glow for Pulsing -->
    <filter id="neonGlowStrong" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <!-- Animated Fill Gradient -->
    <linearGradient id="fillGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff0095">
        <animate attributeName="stop-color" values="#ff0095;#ffae00;#ff0095" dur="4s" repeatCount="indefinite"/>
      </stop>
      <stop offset="100%" stop-color="#afde02">
        <animate attributeName="stop-color" values="#afde02;#ff0095;#afde02" dur="4s" repeatCount="indefinite"/>
      </stop>
    </linearGradient>

    <!-- Orange Gradient for stroke -->
    <linearGradient id="strokeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff4500"/>
      <stop offset="100%" stop-color="#ff8c00"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="600" fill="black" id="layer-rect-2" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"/>

  <!-- Speed Lines Left -->
  <g transform="translate(50, 260)" class="glow-anim" id="layer-g-3" opacity="1" data-layer-base-transform="translate(50, 260)" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1">
    <line x1="0" y1="0" x2="150" y2="0" stroke="#8c00ff" stroke-width="4" stroke-linecap="round" id="layer-line-4" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1">
      <animate attributeName="x1" values="0;-40;0" dur="2s" repeatCount="indefinite"/>
    </line>
    <line x1="20" y1="20" x2="120" y2="20" stroke="#00e1ff" stroke-width="3" stroke-linecap="round" id="layer-line-5" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1">
      <animate attributeName="x1" values="20;-20;20" dur="2.5s" repeatCount="indefinite"/>
    </line>
    <line x1="10" y1="40" x2="160" y2="40" stroke="#ff0000" stroke-width="4" stroke-linecap="round" id="layer-line-6" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1">
      <animate attributeName="x1" values="10;-50;10" dur="1.8s" repeatCount="indefinite"/>
    </line>
  </g>

  <!-- HUD Circle around "ROAD" -->
  <g transform="translate(280, 280) translate(64.29519653320312 2.25604248046875)" id="layer-g-7" opacity="1" data-layer-base-transform="translate(280, 280)" data-layer-tx="64.29519653320312" data-layer-ty="2.25604248046875" data-layer-rot="0" data-layer-center-x="60.734283447265625" data-layer-center-y="-84.32072448730469" data-layer-visible="1">
    <circle r="140" fill="none" stroke="#0091ff" stroke-width="2" stroke-dasharray="10 20" class="glow-anim" style="animation: rotateCircle 15s linear infinite; transform-origin: center;" id="layer-circle-8" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"/>
    <path d="M -150 0 A 150 150 0 0 1 0 -150" fill="none" stroke="#00ffee" stroke-width="4" opacity="0.6" id="layer-path-9" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"/>
    <path d="M 150 0 A 150 150 0 0 1 0 150" fill="none" stroke="#05cce6" stroke-width="4" opacity="0.6" id="layer-path-10" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"/>
  </g>

  <!-- Bird Silhouette and Sigma Symbol Background Right -->
  <g transform="translate(850, 230) translate(-600.088134765625 471.49786376953125)" opacity="0.4" class="glow-anim" id="layer-g-11" data-layer-base-transform="translate(850, 230)" data-layer-tx="-600.088134765625" data-layer-ty="471.49786376953125" data-layer-rot="0" data-layer-center-x="75" data-layer-center-y="70" data-layer-visible="1">
     <!-- Sigma Symbol Background -->
     <path d="M 0 0 L 100 0 L 30 70 L 100 140 L 0 140 L 30 70 Z" fill="none" stroke="#ffae00" stroke-width="2" id="layer-path-12" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"/>
     <!-- Bird Profile -->
     <path d="M 80 20 C 120 20, 150 50, 150 80 C 150 110, 120 140, 80 140 L 50 100 L 80 80 Z" fill="#ffae00" opacity="0.3" id="layer-path-13" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"/>
  </g>

  <!-- Main Text ROAD RUNNER -->
  <g transform="translate(180, 320)" class="glow-anim" id="layer-g-14" opacity="1" data-layer-base-transform="translate(180, 320)" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1">
    <!-- 3D Shadow/Volume Layer -->
    <text x="5" y="5" class="main-text" fill="#277000" opacity="0.8" id="layer-text-15" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"><tspan fill="#002244" id="letter-word-0-0-1770400562853-0" data-word-id="word-0-0-1770400562853" data-letter-index="0" data-word-visible="1" data-duration="0.5" data-delay="0" data-ease="ease-out" style="cursor: pointer;">R</tspan><tspan fill="#002244" id="letter-word-0-0-1770400562853-1" data-word-id="word-0-0-1770400562853" data-letter-index="1" data-word-visible="1" data-duration="0.5" data-delay="0.05" data-ease="ease-out" style="cursor: pointer;">O</tspan><tspan fill="#002244" id="letter-word-0-0-1770400562853-2" data-word-id="word-0-0-1770400562853" data-letter-index="2" data-word-visible="1" data-duration="0.5" data-delay="0.1" data-ease="ease-out" style="cursor: pointer;">A</tspan><tspan fill="#002244" id="letter-word-0-0-1770400562853-3" data-word-id="word-0-0-1770400562853" data-letter-index="3" data-word-visible="1" data-duration="0.5" data-delay="0.15000000000000002" data-ease="ease-out" style="cursor: pointer;">D</tspan><tspan> </tspan><tspan fill="#002244" id="letter-word-0-1-1770400562853-0" data-word-id="word-0-1-1770400562853" data-letter-index="0" data-word-x="366.495849609375" data-word-y="1.596832275390625" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="366.495849609375" y="1.596832275390625" data-duration="0.5" data-delay="0" data-ease="ease-out" style="cursor: pointer;">R</tspan><tspan fill="#002244" id="letter-word-0-1-1770400562853-1" data-word-id="word-0-1-1770400562853" data-letter-index="1" data-word-x="366.495849609375" data-word-y="1.596832275390625" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="441.530029296875" y="1.596832275390625" data-duration="0.5" data-delay="0.05" data-ease="ease-out" style="cursor: pointer;">U</tspan><tspan fill="#002244" id="letter-word-0-1-1770400562853-2" data-word-id="word-0-1-1770400562853" data-letter-index="2" data-word-x="366.495849609375" data-word-y="1.596832275390625" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="524.687255859375" y="1.596832275390625" data-duration="0.5" data-delay="0.1" data-ease="ease-out" style="cursor: pointer;">N</tspan><tspan fill="#002244" id="letter-word-0-1-1770400562853-3" data-word-id="word-0-1-1770400562853" data-letter-index="3" data-word-x="366.495849609375" data-word-y="1.596832275390625" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="617.458740234375" y="1.596832275390625" data-duration="0.5" data-delay="0.15000000000000002" data-ease="ease-out" style="cursor: pointer;">N</tspan><tspan fill="#002244" id="letter-word-0-1-1770400562853-4" data-word-id="word-0-1-1770400562853" data-letter-index="4" data-word-x="366.495849609375" data-word-y="1.596832275390625" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="710.230224609375" y="1.596832275390625" data-duration="0.5" data-delay="0.2" data-ease="ease-out" style="cursor: pointer;">E</tspan><tspan fill="#002244" id="letter-word-0-1-1770400562853-5" data-word-id="word-0-1-1770400562853" data-letter-index="5" data-word-x="366.495849609375" data-word-y="1.596832275390625" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="772.923583984375" y="1.596832275390625" data-duration="0.5" data-delay="0.25" data-ease="ease-out" style="cursor: pointer;">R</tspan></text>
    
    <!-- Main Filled Text -->
    <text x="0" y="0" class="main-text" fill="url(#fillGradient)" id="layer-text-16" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"><tspan fill="url(#fillGradient)" id="letter-word-1-0-1770400562853-0" data-word-id="word-1-0-1770400562853" data-letter-index="0" data-word-visible="1" data-duration="0.5" data-delay="0" data-ease="ease-out" style="cursor: pointer;">R</tspan><tspan fill="url(#fillGradient)" id="letter-word-1-0-1770400562853-1" data-word-id="word-1-0-1770400562853" data-letter-index="1" data-word-visible="1" data-duration="0.5" data-delay="0.05" data-ease="ease-out" style="cursor: pointer;">O</tspan><tspan fill="url(#fillGradient)" id="letter-word-1-0-1770400562853-2" data-word-id="word-1-0-1770400562853" data-letter-index="2" data-word-visible="1" data-duration="0.5" data-delay="0.1" data-ease="ease-out" style="cursor: pointer;">A</tspan><tspan fill="url(#fillGradient)" id="letter-word-1-0-1770400562853-3" data-word-id="word-1-0-1770400562853" data-letter-index="3" data-word-visible="1" data-duration="0.5" data-delay="0.15000000000000002" data-ease="ease-out" style="cursor: pointer;">D</tspan><tspan> </tspan><tspan fill="url(#fillGradient)" id="letter-word-1-1-1770400562853-0" data-word-id="word-1-1-1770400562853" data-letter-index="0" data-word-visible="1" data-duration="0.5" data-delay="0" data-ease="ease-out" style="cursor: pointer;">R</tspan><tspan fill="url(#fillGradient)" id="letter-word-1-1-1770400562853-1" data-word-id="word-1-1-1770400562853" data-letter-index="1" data-word-visible="1" data-duration="0.5" data-delay="0.05" data-ease="ease-out" style="cursor: pointer;">U</tspan><tspan fill="url(#fillGradient)" id="letter-word-1-1-1770400562853-2" data-word-id="word-1-1-1770400562853" data-letter-index="2" data-word-visible="1" data-duration="0.5" data-delay="0.1" data-ease="ease-out" style="cursor: pointer;">N</tspan><tspan fill="url(#fillGradient)" id="letter-word-1-1-1770400562853-3" data-word-id="word-1-1-1770400562853" data-letter-index="3" data-word-visible="1" data-duration="0.5" data-delay="0.15000000000000002" data-ease="ease-out" style="cursor: pointer;">N</tspan><tspan fill="url(#fillGradient)" id="letter-word-1-1-1770400562853-4" data-word-id="word-1-1-1770400562853" data-letter-index="4" data-word-visible="1" data-duration="0.5" data-delay="0.2" data-ease="ease-out" style="cursor: pointer;">E</tspan><tspan fill="url(#fillGradient)" id="letter-word-1-1-1770400562853-5" data-word-id="word-1-1-1770400562853" data-letter-index="5" data-word-visible="1" data-duration="0.5" data-delay="0.25" data-ease="ease-out" style="cursor: pointer;">R</tspan></text>
    
    <!-- Animated Tracing Stroke -->
    <text x="0" y="0" class="main-text trace" fill="none" stroke="url(#strokeGradient)" stroke-width="2" id="layer-text-17" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-0-1770400562853-0" data-word-id="word-2-0-1770400562853" data-letter-index="0" data-word-visible="1" data-duration="0.5" data-delay="0" data-ease="ease-out" style="cursor: pointer;">R</tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-0-1770400562853-1" data-word-id="word-2-0-1770400562853" data-letter-index="1" data-word-visible="1" data-duration="0.5" data-delay="0.05" data-ease="ease-out" style="cursor: pointer;">O</tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-0-1770400562853-2" data-word-id="word-2-0-1770400562853" data-letter-index="2" data-word-visible="1" data-duration="0.5" data-delay="0.1" data-ease="ease-out" style="cursor: pointer;">A</tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-0-1770400562853-3" data-word-id="word-2-0-1770400562853" data-letter-index="3" data-word-visible="1" data-duration="0.5" data-delay="0.15000000000000002" data-ease="ease-out" style="cursor: pointer;">D</tspan><tspan> </tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-1-1770400562853-0" data-word-id="word-2-1-1770400562853" data-letter-index="0" data-word-visible="1" data-duration="0.5" data-delay="0" data-ease="ease-out" style="cursor: pointer;">R</tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-1-1770400562853-1" data-word-id="word-2-1-1770400562853" data-letter-index="1" data-word-visible="1" data-duration="0.5" data-delay="0.05" data-ease="ease-out" style="cursor: pointer;">U</tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-1-1770400562853-2" data-word-id="word-2-1-1770400562853" data-letter-index="2" data-word-visible="1" data-duration="0.5" data-delay="0.1" data-ease="ease-out" style="cursor: pointer;">N</tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-1-1770400562853-3" data-word-id="word-2-1-1770400562853" data-letter-index="3" data-word-visible="1" data-duration="0.5" data-delay="0.15000000000000002" data-ease="ease-out" style="cursor: pointer;">N</tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-1-1770400562853-4" data-word-id="word-2-1-1770400562853" data-letter-index="4" data-word-visible="1" data-duration="0.5" data-delay="0.2" data-ease="ease-out" style="cursor: pointer;">E</tspan><tspan fill="none" stroke="url(#strokeGradient)" id="letter-word-2-1-1770400562853-5" data-word-id="word-2-1-1770400562853" data-letter-index="5" data-word-visible="1" data-duration="0.5" data-delay="0.25" data-ease="ease-out" style="cursor: pointer;">R</tspan></text>
  </g>

  <!-- Sigma Subtitle -->
  <g transform="translate(780, 385)" class="glow-anim" id="layer-g-18" opacity="1" data-layer-base-transform="translate(780, 385)" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1">
     <text class="sigma-text" fill="white" style="text-shadow: 0 0 10px #ffae00;" id="layer-text-19" opacity="1" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1"><tspan fill="white" font-weight="bold" font-style="italic" id="letter-word-3-0-1770400562853-0-1770932786272" data-word-id="word-3-0-1770400562853" data-letter-index="0" data-word-x="226.6475372314453" data-word-y="-168.3105010986328" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="131.97466398908" y="-148.89405155181885" data-duration="0.5" data-delay="0" data-ease="ease-out" style="cursor: pointer;">s</tspan><tspan fill="white" font-weight="bold" font-style="italic" id="letter-word-3-0-1770400562853-1-1770932786272" data-word-id="word-3-0-1770400562853" data-letter-index="1" data-word-x="226.6475372314453" data-word-y="-168.3105010986328" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="156.11773039533" y="-148.89405155181885" data-duration="0.5" data-delay="0.05" data-ease="ease-out" style="cursor: pointer;">t</tspan><tspan fill="white" font-weight="bold" font-style="italic" id="letter-word-3-0-1770400562853-2-1770932786272" data-word-id="word-3-0-1770400562853" data-letter-index="2" data-word-x="226.6475372314453" data-word-y="-168.3105010986328" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="176.74273039533" y="-148.89405155181885" data-duration="0.5" data-delay="0.1" data-ease="ease-out" style="cursor: pointer;">u</tspan><tspan fill="white" font-weight="bold" font-style="italic" id="letter-word-3-0-1770400562853-3-1770932786272" data-word-id="word-3-0-1770400562853" data-letter-index="3" data-word-x="226.6475372314453" data-word-y="-168.3105010986328" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="209.64067961408" y="-148.89405155181885" data-duration="0.5" data-delay="0.15000000000000002" data-ease="ease-out" style="cursor: pointer;">d</tspan><tspan fill="white" font-weight="bold" font-style="italic" id="letter-word-3-0-1770400562853-4-1770932786272" data-word-id="word-3-0-1770400562853" data-letter-index="4" data-word-x="226.6475372314453" data-word-y="-168.3105010986328" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="242.24321867658" y="-148.89405155181885" data-duration="0.5" data-delay="0.2" data-ease="ease-out" style="cursor: pointer;">.</tspan><tspan fill="white" font-weight="bold" font-style="italic" id="letter-word-3-0-1770400562853-5-1770932786272" data-word-id="word-3-0-1770400562853" data-letter-index="5" data-word-x="226.6475372314453" data-word-y="-168.3105010986328" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="257.14800383283" y="-148.89405155181885" data-duration="0.5" data-delay="0.25" data-ease="ease-out" style="cursor: pointer;">i</tspan><tspan fill="white" font-weight="bold" font-style="italic" id="letter-word-3-0-1770400562853-6-1770932786272" data-word-id="word-3-0-1770400562853" data-letter-index="6" data-word-x="226.6475372314453" data-word-y="-168.3105010986328" data-word-rot="0" data-word-manual="1" data-word-visible="1" x="274.60405852033" y="-148.89405155181885" data-duration="0.5" data-delay="0.30000000000000004" data-ease="ease-out" style="cursor: pointer;">o</tspan></text>
     <!-- Small Sigma Symbol -->
     <path d="M -40 -10 L -10 -10 L -25 10 L -10 30 L -40 30" fill="none" stroke="#ffae00" stroke-width="4" stroke-linecap="round" id="layer-path-20" transform="translate(-430.8904113769531 305.68402099609375)" data-layer-base-transform="" data-layer-tx="-430.8904113769531" data-layer-ty="305.68402099609375" data-layer-rot="0" data-layer-center-x="-25" data-layer-center-y="10" opacity="1" data-layer-visible="1"/>
  </g>

  <!-- Lightning Decorative Arc -->
  <path d="M 500 220 Q 700 180 900 250" fill="none" stroke="#1eff00" stroke-width="1" opacity="0.5" id="layer-path-21" data-layer-tx="0" data-layer-ty="0" data-layer-rot="0" data-layer-center-x="0" data-layer-center-y="0" data-layer-visible="1">
    <animate attributeName="stroke-dasharray" values="0,500; 500,0; 0,500" dur="2s" repeatCount="indefinite"/>
  </path>
</svg>`;

  // Кодируем SVG в base64 и логируем как фон в консоль [web:20][web:23]
  const svgBase64 = btoa(unescape(encodeURIComponent(svg)));

  // Размер “плашки” в консоли (подгони под себя)
  const width = 600;
  const height = 300;

  console.log(
    "%c ",
    [
      `padding: ${height / 2}px ${width / 2}px;`,
      `background-image: url("data:image/svg+xml;base64,${svgBase64}");`,
      "background-size: cover;",
      "background-position: center center;",
      "background-repeat: no-repeat;",
      "line-height: 0;",
      "color: transparent;",
    ].join("")
  );

  console.log(
    "%cROAD RUNNER STUDIO%c — console edition\n" +
    "%cDeveloped with %c❤️%c by %c@FDTiger777\n",
    "color:#3b82f6;font-weight:bold;font-size:14px",
    "color:#a855f7;font-size:12px",
    "color: #94a3b8; font-size: 12px;",
    "color: #ef4444; font-size: 12px;",
    "color: #94a3b8; font-size: 12px;",
    "color: #3b82f6; font-weight: bold; font-size: 12px; text-decoration: underline;"
  );
  console.log(
    "%cRoad Runner Studio • Build Info\n" +
    "%cversion%c     2.8.3\n" +
    "%cenvironment%c production\n",
    // заголовок — как основной брендовый текст, но чуть мельче
    "color:#3b82f6;font-weight:bold;font-size:13px",
    // label "version"
    "color:#94a3b8;font-size:12px",
    // value "2.8.3"
    "color:#a855f7;font-size:12px",
    // label "environment"
    "color:#94a3b8;font-size:12px",
    // value "production"
    "color:#22c55e;font-size:12px;font-weight:bold;"
  );
};

