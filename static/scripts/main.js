const supabaseUrl = 'https://uwjfigexpjkojdakgubs.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3amZpZ2V4cGprb2pkYWtndWJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzUxNzQ5NTYsImV4cCI6MjA1MDc1MDk1Nn0.aqfaXKeqmejmomkyJzQF2UVd2FoD9E60yeQvQ0DL5pA';
const client = supabase.createClient(supabaseUrl, supabaseKey);

const $logoutBtn = $('#logout-btn');

async function setAuthView(data) {
  if (data.session) {
    $('#login-btn').addClass('hide');
    $logoutBtn.removeClass('hide');
  } else {
    $('#login-btn').removeClass('hide');
    $logoutBtn.addClass('hide');
  }
}

$logoutBtn.click(async () => {
  // Sign out the user
  const { error } = await client.auth.signOut();
  console.error(error);
  if (error) alert(error.message);
  else await setAuthView({ session: null });
});

(async () => {
  const { data, error } = await client.auth.getSession();
  console.log('session:', data, error);
  await setAuthView(data);
})();
