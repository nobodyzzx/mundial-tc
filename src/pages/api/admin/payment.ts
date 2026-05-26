import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';
import { DEPOSITO_BS, PAGO_COMPLETO_BS, haPagadoDeposito } from '@/lib/payments';

// Atajos rápidos del panel: escriben monto_pagado (fuente única de verdad);
// los flags pago_70/pago_50 los deriva el trigger sync_payment_flags en la DB.
// Para montos exactos (ej. 80 Bs) está el input de /api/admin/set-monto-pagado.
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const userId = form.get('userId')?.toString();
  const field  = form.get('field')?.toString();   // 'pago70' | 'pago50'
  const value  = form.get('value')?.toString() === 'true';

  if (!userId || !field) return redirect('/admin?err=Datos+incompletos');

  if (field === 'pago70') {
    // Marcar depósito → 70 Bs; desmarcar → 0
    await supabaseAdmin
      .from('profiles')
      .update({ monto_pagado: value ? DEPOSITO_BS : 0 })
      .eq('id', userId);
  } else if (field === 'pago50') {
    if (value) {
      // Marcar completo → 120 Bs; requiere depósito previo
      const { data: target } = await supabaseAdmin
        .from('profiles').select('monto_pagado').eq('id', userId).single();
      if (!haPagadoDeposito(target?.monto_pagado)) return redirect('/admin?err=Debe+confirmar+el+pago+de+70+Bs+primero');
      await supabaseAdmin.from('profiles').update({ monto_pagado: PAGO_COMPLETO_BS }).eq('id', userId);
    } else {
      // Desmarcar completo → vuelve al depósito (70 Bs)
      await supabaseAdmin.from('profiles').update({ monto_pagado: DEPOSITO_BS }).eq('id', userId);
    }
  } else {
    return redirect('/admin?err=Campo+no+válido');
  }

  return redirect('/admin?msg=Pago+actualizado');
};
