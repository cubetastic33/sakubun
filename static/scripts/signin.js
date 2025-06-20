// If the user is signed in, redirect them to the home page
// They have to sign out before they can see this page again
(async () => {
  const { data: {session}, error } = await client.auth.getSession();
  if (error) console.error(error);
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
