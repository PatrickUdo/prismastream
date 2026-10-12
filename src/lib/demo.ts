// Build flag for the fictional demo library. Production builds set VITE_DEMO=false: no demo
// source in local mode, and the demo data is not bundled (it is only reached through a dynamic
// import behind this constant, which the bundler removes as dead code).
export const DEMO: boolean = import.meta.env.VITE_DEMO !== 'false';
