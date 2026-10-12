import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import 'katex/dist/katex.min.css'

export default {
  extends: DefaultTheme,
} satisfies Theme
