import { getPendingBillingDecisions } from '@/actions/billing/queries';
import { NextResponse } from 'next/server';

/**
 * API Route: 取得待裁決時數紀錄
 */
export async function GET() {
  const result = await getPendingBillingDecisions();
  
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: result.data,
  });
}
