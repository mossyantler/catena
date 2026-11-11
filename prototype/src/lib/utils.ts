import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// index.css의 테마 토큰을 알려 주어 text-section이 색이 아니라 글자 크기로 합쳐지게 한다.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['2xs', 'section', 'title'], radius: ['dot'] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
