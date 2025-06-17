const supabaseUrl = 'https://uwjfigexpjkojdakgubs.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3amZpZ2V4cGprb2pkYWtndWJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzUxNzQ5NTYsImV4cCI6MjA1MDc1MDk1Nn0.aqfaXKeqmejmomkyJzQF2UVd2FoD9E60yeQvQ0DL5pA';
const client = supabase.createClient(supabaseUrl, supabaseKey);

// If the user is signed in, redirect them to the home page
// They have to sign out before they can see this page again
(async () => {
  const { data: {session}, error } = await client.auth.getSession();
  console.log('session:', session, error);
  if (session) location.href = '/';
})();

const $signupForm = $('#signup-form');
const $signinForm = $('#signin-form');
const $error = $('#error');

// Handle sign up form submit
$signupForm.submit(async evt => {
  evt.preventDefault();
  // Check if password matches with confirm password
  const password = $('#password').val();
  if (password !== $('#confirm-password').val()) {
    $error.text('Passwords don\'t match!');
    return;
  }
  // Clear any error messages
  $error.empty();
  const { data, error } = await client.auth.signUp({
    email: $('#email').val().trim(),
    password,
    options: {
      emailRedirectTo: new URL(window.location.href).origin,
    },
  });
  console.log(data, error);
  if (error) $error.text('Error: ' + error.message);
  else alert('Check your inbox for a verification email!');
});

// Handle sign in form submit
$signinForm.submit(async evt => {
  evt.preventDefault();
  // Clear any error messages
  $error.empty();
  const { data, error } = await client.auth.signInWithPassword({
    email: $('#email').val().trim(),
    password: $('#password').val(),
  });
  console.log(data, error);
  if (error) $error.text('Error: ' + error.message);
  else location.href = '/';
});
