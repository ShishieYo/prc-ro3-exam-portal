// GitHub Pages serves 404.html for unknown paths; reuse index.html so client-side routes work.
import { copyFileSync } from 'node:fs'
copyFileSync('dist/index.html', 'dist/404.html')
