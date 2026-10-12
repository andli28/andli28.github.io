declare module '*.css' {}

declare module 'markdown-it-katex' {
  import type { PluginSimple } from 'markdown-it'

  const markdownItKatex: PluginSimple
  export default markdownItKatex
}
