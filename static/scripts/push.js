// Streak reminder push notifications

const $push_toggle = $('#push_toggle');
const VAPID_PUBLIC_KEY = $push_toggle.attr('data-vapid');

function push_supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    && !!VAPID_PUBLIC_KEY;
}

function urlBase64ToUint8Array(base64String) {
  // Converts the base64url VAPID public key to the format pushManager.subscribe expects
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(character => character.charCodeAt(0)));
}

async function get_push_subscription() {
  const registration = await navigator.serviceWorker.ready;
  return await registration.pushManager.getSubscription();
}

function set_push_icon(subscribed) {
  $push_toggle.find('.material-icons').text(subscribed ? 'notifications_active' : 'notifications_off');
  $push_toggle.find('.push-label').text(subscribed ? 'Reminders On' : 'Reminders Off');
  $push_toggle.prop('title', subscribed
    ? 'Stop reminding me about my streak'
    : 'Remind me at 7pm if my streak is at risk');
}

async function update_toggle_visibility() {
  // The reminder toggle is only shown to signed in users, and to users who already
  // subscribed (so they can unsubscribe)
  if (!push_supported()) return;
  const subscription = await get_push_subscription();
  const subscribed = !!subscription && Notification.permission === 'granted';
  const { data: {session} } = await client.auth.getSession();
  set_push_icon(subscribed);
  $push_toggle.toggle(subscribed || !!session);
}

async function sync_push_subscription() {
  // Saves the subscription and current streak state, so the server knows when a
  // reminder is needed.
  if (!push_supported()) return;
  const { data: {session} } = await client.auth.getSession();
  if (!session) return;
  const subscription = await get_push_subscription();
  if (!subscription || Notification.permission !== 'granted') return;
  const json = subscription.toJSON();
  const { current_streak, last_active_date } = compute_streaks(await get_days_learnt());
  const { error } = await client.from('push_subscriptions').upsert({
    endpoint: subscription.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    current_streak: current_streak,
    last_active_date: last_active_date,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) return console.error('Error syncing push subscription', error);
  // Keep the streak state of any other devices fresh, so a device that wasn't used
  // today doesn't send a reminder for a streak that was already maintained
  await client.from('push_subscriptions')
    .update({ current_streak: current_streak, last_active_date: last_active_date })
    .eq('user_id', session.user.id);
  // If the push service rotated the endpoint, delete the row for the old one
  const old_endpoint = localStorage.getItem('push_endpoint');
  if (old_endpoint && old_endpoint !== subscription.endpoint) {
    await client.from('push_subscriptions').delete().eq('endpoint', old_endpoint);
  }
  localStorage.setItem('push_endpoint', subscription.endpoint);
}

$push_toggle.on('click', async () => {
  const subscription = await get_push_subscription();
  if (subscription && Notification.permission === 'granted') {
    // Unsubscribe
    const { error } = await client.from('push_subscriptions').delete()
      .eq('endpoint', subscription.endpoint);
    if (error) console.error('Error deleting push subscription', error);
    await subscription.unsubscribe();
    localStorage.removeItem('push_endpoint');
    set_push_icon(false);
  } else {
    // Explain the feature in a dialog before asking for notification permission
    $('#push_denied').hide();
    $('#push_dialog + .overlay').show();
    $('#push_dialog').show('slow');
  }
});

$('#enable_push').on('click', async () => {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    const registration = await navigator.serviceWorker.ready;
    await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    await sync_push_subscription();
    set_push_icon(true);
    $('#push_dialog').hide('slow', () => $('#push_dialog + .overlay').hide());
  } else if (permission === 'denied') {
    $('#push_denied').show();
  }
  // If the permission prompt was dismissed, keep the dialog open so the user can try again
});

client.auth.onAuthStateChange(async event => {
  // Reminders are only for signed in users, so unsubscribe when the user signs out.
  if (event === 'SIGNED_OUT' && push_supported()) {
    const subscription = await get_push_subscription();
    if (subscription) await subscription.unsubscribe();
    localStorage.removeItem('push_endpoint');
    $push_toggle.hide();
  }
});

(async () => {
  await update_toggle_visibility();
  await sync_push_subscription();
})();
