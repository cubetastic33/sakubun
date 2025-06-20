// If the user is signed in, redirect them to the home page
// They have to sign out before they can see this page again
(async () => {
  const { data: {session}, error } = await client.auth.getSession();
  if (error) console.error(error);
  if (session) location.href = '/';
})();

const $error = $('#error');

// Handle sign up form submit
$('#signup-form').submit(async evt => {
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
$('#signin-form').submit(async evt => {
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

$('#forgot-password').on('click', async evt => {
  evt.preventDefault();
  const email = prompt('What is your email address?').trim();
  if (!email.length) return;
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${new URL(window.location.href).origin}/reset_password`,
  });
  if (error) {
    console.error(error);
    alert(error.message);
  } else alert('Please check your inbox for password reset instructions.');
});
