import { NextResponse } from 'next/server';
import { withOperator } from '@/lib/agent/auth';
import { listCategoryTitleContexts, saveAutomationSettings } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

const PREFIX = 'category-title-context:';

async function handleGET() {
  try { return NextResponse.json({ contexts: listCategoryTitleContexts() }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 500 }); }
}

async function handlePOST(request) {
  try {
    const { categoryId, context } = await request.json();
    const key = String(categoryId || 'default');
    if (!/^(default|\d{1,10})$/.test(key) || typeof context !== 'string' || context.length > 4000) {
      return NextResponse.json({ error: 'Invalid category or title context (maximum 4,000 characters).' }, { status: 400 });
    }
    saveAutomationSettings({ id: `${PREFIX}${key}`, name: 'Category title context', settings: { context } });
    return NextResponse.json({ categoryId: key, context });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: 500 }); }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
