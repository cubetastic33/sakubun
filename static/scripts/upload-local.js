const $logoutBtn = $('#logout-btn');
const $uploadLocal = $('#upload-local');
const $knownKanjiContainer = $('#known-kanji-container');
const $quizStreaksContainer = $('#quiz-streaks-container');
const $savedEssaysContainer = $('#saved-essays-container');

// Event handler to close the upload-local dialog
$(`#upload-local .close, #upload-local + .overlay`).click(() => {
  $uploadLocal.hide('slow', () => $(`#upload-local + .overlay`).hide());
});

async function setAuthView(session) {
  if (session) {
    $('#login-btn').addClass('hide');
    $logoutBtn.removeClass('hide');
    $logoutBtn.prop('title', 'Sign out of ' + session.user.email);
    $('.logged-out').hide();
    // Get local and online versions of each data table
    const { data: known_kanji } = await client.from('known_kanji').select().eq('user_id', session.user.id);
    const local_kanji = localStorage.getItem('known_kanji') || '';
    const { data: streaks } = await client.from('streaks').select().eq('user_id', session.user.id);
    const local_streaks = Object.keys(JSON.parse(localStorage.getItem('days_learnt')) || {});
    const { data: essays } = await client.from('essays').select().eq('user_id', session.user.id);
    const local_essays = JSON.parse(localStorage.getItem('saved_essays')) || [];
    // If any of those tables have data locally but not online, show this dialog
    // If they explicitly clicked No, data.length will be 1
    if (known_kanji.length === 0 && local_kanji.length) {
      // There are no saved kanji upstream but we do have kanji locally
      $uploadLocal.show('slow');
      $('#upload-local + .overlay').show();
      $('#num-kanji').text(local_kanji.length);
      $knownKanjiContainer.removeClass('hide');
    }
    if (streaks.length === 0 && local_streaks.length) {
      // There is no streaks data upstream but we do have days_learnt locally
      $uploadLocal.show('slow');
      $('#upload-local + .overlay').show();
      $('#num-days').text(local_streaks.length + ' day' + (local_streaks.length === 1 ? '' : 's'));
      $quizStreaksContainer.removeClass('hide');
    }
    if (essays.length === 0 && local_essays.length) {
      // We don't show the dialog if essays are the only data discrepancy
      // This is because there's no easy way to implement the 'ask me next time' feature
      $('#num-essays').text(local_essays.length + ' saved essay' + (local_essays.length === 1 ? '' : 's'));
      $savedEssaysContainer.removeClass('hide');
    }
  } else {
    $('#login-btn').removeClass('hide');
    $logoutBtn.addClass('hide');
    $('.logged-out').show();
  }
}

function showUploadError(error) {
  if (error) {
    console.error(error);
    $('#upload-error').text('Error: ' + error.message);
    return true;
  }
}

$('#dont-upload').on('click', async () => {
  // The user clicked No, so write empty rows to the relevant tables. This makes sure we don't show
  // the dialog next time.
  const { data: { session: {user} }, error } = await client.auth.getSession();
  if (showUploadError(error)) return;
  if (!$knownKanjiContainer.hasClass('hide')) {
    // Make sure we're not overwriting upstream data
    const known_kanji = await client.from('known_kanji').select().eq('user_id', user.id);
    if (known_kanji.data.length === 0) {
      const { error } = await client.from('known_kanji').insert({});
      if (showUploadError(error)) return;
    }
  }
  if (!$quizStreaksContainer.hasClass('hide')) {
    // Make sure we're not overwriting upstream data
    const streaks = await client.from('streaks').select().eq('user_id', user.id);
    if (streaks.data.length === 0) {
      const { error } = await client.from('streaks').insert({});
      if (showUploadError(error)) return;
    }
  }
  $uploadLocal.hide('slow', () => $(`#upload-local + .overlay`).hide());
});

$('#yes-upload').on('click', async () => {
  // The user clicked Yes, so write empty rows if the checkbox is unselected, and data otherwise
  const { data: { session: {user} }, error } = await client.auth.getSession();
  if (showUploadError(error)) return;
  if (!$knownKanjiContainer.hasClass('hide') && $('#known-kanji').is(':checked')) {
    // Make sure we're not overwriting upstream data
    const known_kanji = await client.from('known_kanji').select().eq('user_id', user.id);
    if (known_kanji.data.length === 0) {
      const { error } = await client.from('known_kanji').insert({
        'known_kanji': localStorage.getItem('known_kanji'),
        'known_priority_kanji': localStorage.getItem('known_priority_kanji'),
      });
      if (showUploadError(error)) return;
    } else $('#upload-error').text('Error: There is now data upstream. Try refreshing the page.');
  }
  if (!$quizStreaksContainer.hasClass('hide') && $('#quiz-streaks').is(':checked')) {
    // Make sure we're not overwriting upstream data
    const streaks = await client.from('streaks').select().eq('user_id', user.id);
    if (streaks.data.length === 0) {
      const { error } = await client.from('streaks').insert({
        'quiz_days_learnt': JSON.parse(localStorage.getItem('days_learnt')),
      });
      if (showUploadError(error)) return;
    } else $('#upload-error').text('Error: There is now data upstream. Try refreshing the page.');
  }
  if (!$savedEssaysContainer.hasClass('hide') && $('#saved-essays').is(':checked')) {
    // Make sure we're not overwriting upstream data
    const essays = await client.from('essays').select().eq('user_id', user.id);
    if (essays.data.length === 0) {
      let local_essays = JSON.parse(localStorage.getItem('saved_essays'));
      for (let i = 0; i < local_essays.length; i++) {
        const { error } = await client.from('essays').insert({
          'name': local_essays[i][1],
          'content': localStorage.getItem('essay' + local_essays[i][0]),
        });
        if (showUploadError(error)) return;
      }
    } else $('#upload-error').text('Error: There is now data upstream. Try refreshing the page.');
  }
  $uploadLocal.hide('slow', () => $(`#upload-local + .overlay`).hide());
});

$logoutBtn.click(async () => {
  // Sign out the user
  const { error } = await client.auth.signOut();
  if (error) {
    console.error(error);
    alert(error.message);
  }
  else await setAuthView();
});

(async () => {
  const { data: {session}, error } = await client.auth.getSession();
  if (error) console.error(error);
  await setAuthView(session);
})();
