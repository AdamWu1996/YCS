import { redirect } from 'next/navigation';

/**
 * 根頁面 - 重定向到請款裁決看板
 */
export default function HomePage() {
  redirect('/dashboard/billing');
}
