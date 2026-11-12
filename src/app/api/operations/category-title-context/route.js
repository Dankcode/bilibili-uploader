import { NextResponse } from 'next/server';
import { withOperator } from '@/lib/agent/auth';
import { listCategoryTitleContexts, saveCategoryTitleContext } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

async function handleGET() {
  try { return NextResponse.json({ contexts: listCategoryTitleContexts() }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 500 }); }
}

async function handlePOST(request) {
  try {
    const { categoryId, context } = await request.json();
    return NextResponse.json(saveCategoryTitleContext(categoryId, context));
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 500 }); }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
