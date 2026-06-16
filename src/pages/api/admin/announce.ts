import type { APIRoute } from 'astro';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { getAdminUser } from '@/lib/auth-helpers';
import { sendWhatsApp } from '@/lib/whatsapp';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const admin = await getAdminUser(cookies, supabase, supabaseAdmin);
  if (!admin) return redirect('/login');

  const form = await request.formData();
  const back = '/admin/anuncios';

  // Borrar un anuncio del tablón (no borra el mensaje ya enviado a WhatsApp)
  if (form.get('_action')?.toString() === 'delete') {
    const id = form.get('id')?.toString();
    if (id) await supabaseAdmin.from('announcements').delete().eq('id', id);
    return redirect(`${back}?msg=Anuncio+eliminado`);
  }

  const body   = form.get('body')?.toString().trim();
  const notify = form.get('notify')?.toString() === 'on'; // ¿enviar al grupo?

  if (!body) return redirect(`${back}?err=Escribe+un+mensaje`);

  // Publicar en el grupo de WhatsApp (opcional). Nunca rompe el guardado.
  let sent = false;
  let waDetail: string | null = null;
  let notifyNote = '';
  if (notify) {
    try {
      const text = [
        '📣 *ANUNCIO*',
        '',
        body,
        '',
        `— ${admin.username}, Réferi ⚖️`,
        '_Polla Mundial 2026_ 🏆',
      ].join('\n');
      const res = await sendWhatsApp(text, 'anuncio');
      sent = res.ok;
      waDetail = res.detail ?? null;
      notifyNote = !res.configured
        ? ' (WhatsApp no configurado)'
        : res.ok ? ' y enviado al grupo' : ' (no se pudo enviar al grupo)';
    } catch (e: any) {
      notifyNote = ' (no se pudo enviar al grupo)';
      waDetail = e?.message ?? 'error';
    }
  }

  // Guardar en el tablón (se muestra dentro de la app)
  const { error } = await supabaseAdmin.from('announcements').insert({
    body,
    author_name: admin.username,
    created_by: admin.user.id,
    sent_to_whatsapp: sent,
    wa_detail: waDetail,
  });

  if (error) return redirect(`${back}?err=${encodeURIComponent('No se pudo guardar el anuncio')}`);

  return redirect(`${back}?msg=${encodeURIComponent('Anuncio publicado' + notifyNote)}`);
};
