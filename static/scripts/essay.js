// Commonly used selectors
const $saved = $('#saved');
const $saved_ul = $('#saved ul');
const $settings = $('#settings');
const $generate = $('#generate');
const $min = $('#min');
const $max = $('#max');
const $direction = $('#direction');
const $essay = $('#essay');
const $report_dialog_button = $('#report_dialog button');
const $save_dialog_button = $('#save_dialog button');
const $num_found = $('#num_found');
const $import_dialog_ul = $('#import_dialog ul');
const $import_submit = $('#import_submit');

// Overwrite the setAuthView function from main.js
async function setAuthView(data) {
  if (data.session) {
    $('#login-btn').addClass('hide');
    $logoutBtn.removeClass('hide');
    $('#export').hide();
    $('#import_button').hide();
    $('#generate').css('margin-left', 'auto');
  } else {
    $('#login-btn').removeClass('hide');
    $logoutBtn.addClass('hide');
    $('#export').show();
    $('#import_button').show();
    $('#generate').css('margin-left', '.5em');
  }
  await list_essays();
  $('#loading').hide();
  $('main').removeClass('hide');
}

// Database access functions

async function get_known_kanji(user) {
  // auth.getUser() performs a network call so share the user by passing it as an argument
  if (user) {
    let { data } = await client.from('known_kanji').select('known_kanji, known_priority_kanji').eq('user_id', user.id);
    return {
      known_kanji: new Set(data.length ? data[0].known_kanji : []),
      known_priority_kanji: new Set(data.length ? data[0].known_priority_kanji : []),
    };
  } else return {
    known_kanji: new Set(localStorage.getItem('known_kanji')),
    known_priority_kanji: new Set(localStorage.getItem('known_priority_kanji')),
  };
}

async function get_saved_essays(user) {
  if (user) return (await client.from('essays').select('id, name').eq('user_id', user.id)).data;
  else {
    const essays = JSON.parse(localStorage.getItem('saved_essays')) || [];
    return essays.map(essay => {return { id: essay[0], name: essay[1] }});
  }
}

async function get_essay(essay_id) {
  const { data: {user} = {} } = await client.auth.getUser();
  if (user) {
    return (await client.from('essays').select('content').eq('id', essay_id)).data[0].content;
  } else return localStorage.getItem('essay' + essay_id);
}

async function save_essay(name, content) {
  const { data: {user} = {} } = await client.auth.getUser();
  if (user) {
    const { data, error } = await client.from('essays').insert({ name, content }).select();
    if (error) {
      console.log('Error saving essay', error);
      alert(error.message);
    }
    return data[0].id;
  } else {
    let saved_essays = JSON.parse(localStorage.getItem('saved_essays')) || [];
    const timestamp = Date.now();
    saved_essays.push([timestamp, name]);
    localStorage.setItem('saved_essays', JSON.stringify(saved_essays));
    // Save the actual essay
    localStorage.setItem('essay' + timestamp, content);
    return timestamp;
  }
}

async function unsave_essay(essay_id) {
  const { data: {user} = {} } = await client.auth.getUser();
  if (user) {
    const response = await client.from('essays').delete().eq('id', essay_id);
    console.log(response);
  } else {
    let saved_essays = JSON.parse(localStorage.getItem('saved_essays'));
    if (saved_essays === null) return; // Happens when the essay was deleted from a different tab
    for (let i = 0; i < saved_essays.length; i++) {
      if (saved_essays[i][0].toString() === essay_id) {
        // Remove this essay from the saved essays list
        saved_essays.splice(i, 1);
        // Remove the saved essay itself
        localStorage.removeItem('essay' + essay_id);
        localStorage.setItem('saved_essays', JSON.stringify(saved_essays));
        return;
      }
    }
  }
}

// End of database access functions

async function list_essays() {
  const { data: {user} = {} } = await client.auth.getUser();
  let { known_kanji } = await get_known_kanji(user);
  if (!known_kanji.size) {
    $('#saved, #settings *:not(.container):not(.always):not(.always *)').hide();
    $('#range').html(
      'You don\'t have a kanji list, so you can\'t use this feature yet. Go to '
      + '<a href="/known_kanji">known kanji</a> and create a list first.',
    );
  } else {
    // Set the default values for min and max based on the number of kanji added
    $min[0].setAttribute('value', Math.min(1, known_kanji.size));
    $max[0].setAttribute('value', Math.min(15, known_kanji.size));

    const saved_essays = await get_saved_essays(user);
    if (saved_essays && saved_essays.length) {
      for (let i = 0; i < saved_essays.length; i++) {
        $saved_ul.append(`<li data-id="${saved_essays[i].id}">${saved_essays[i].name}</li>`);
      }
      handle_essay_selection();
    } else {
      $saved.hide();
    }
  }
}

//
// Restore settings from localStorage
//

let direction = localStorage.getItem('direction');
let settings_min = localStorage.getItem('min_essay');
let settings_max = localStorage.getItem('max_essay');

// The default direction is vertical
if (direction !== 'horizontal') $essay.addClass('vertical');
$direction.text(direction !== 'horizontal' ? 'Vertical' : 'Horizontal');

if (settings_min) $min.val(settings_min);
if (settings_max) $max.val(settings_max);
$max.prop('min', $min.val());
$min.prop('max', $max.val());

$direction.on('click', function () {
  let to_ver = $(this).text() === 'Horizontal';
  console.log(to_ver);
  localStorage.setItem('direction', to_ver ? 'vertical' : 'horizontal');
  $(this).text(to_ver ? 'Vertical' : 'Horizontal');
  $('body').toggleClass('vertical', to_ver);
});

function handle_essay_clicks() {
  // Add click handlers to the essay sentences
  $('#essay > span').on('click', function () {
    $('#floating section').html(`
            <b>Sentence:</b> <span id="question" class="ja">${this.innerText}</span><br>
            <b>Reading:</b> <span id="kana">${this.dataset.reading}</span><br>
            <b>Meaning:</b> <span id="meaning">${this.dataset.meaning}</span>
        `).parent().attr('data-id', this.dataset.id).show('slow');
    // Focus the close button so pressing enter closes the dialog
    $('#floating .close').focus();
  });
}

function handle_essay_selection() {
  // Add click handlers to allow selection of an essay
  $('#saved li').on('click', async function () {
    $settings.hide();
    $saved.hide();
    // Set the direction of text
    $('body').toggleClass('vertical', localStorage.getItem('direction') !== 'horizontal');
    // Show the saved essay
    $essay
      .html(await get_essay(this.dataset.id))
      .data('id', this.dataset.id)
      .show();
    $('#saved_name').text(this.innerText);
    handle_essay_clicks();
    $('#info, #unsave, #saved_name, #direction').show();
  });
}

//
// Export saved essays - this is only implemented with local storage.
//

function download(filename, text) {
  // Download a file
  let element = document.createElement("a");
  element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text));
  element.setAttribute("download", filename);
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

$('#export').on('click', function () {
  let d = new Date();
  let filename = `sakubun_essays_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}.txt`;
  let essays = [];
  let saved_essays = JSON.parse(localStorage.getItem('saved_essays'));
  if (saved_essays === null) {
    alert('No saved essays!');
    return;
  }
  for (let i = 0; i < saved_essays.length; i++) {
    essays.push([saved_essays[i][0], saved_essays[i][1], localStorage.getItem('essay' + saved_essays[i][0])]);
  }
  download(filename, JSON.stringify(essays));
});

//
// Import essays from file - this is also only implemented with local storage.
//

$('#import_button').on('click', () => {
  // Reset the file stats
  $num_found.text(0);
  $import_dialog_ul.empty();
  $import_submit.prop('disabled', true);
  // Show the import dialog
  $('#import_dialog + .overlay').show();
  $('#import_dialog').show('slow');
});

$('#import_file').on('change', () => {
  // A new file has been selected
  $import_submit.prop('disabled', true);
  // Reset the file stats
  $num_found.text(0);
  $import_dialog_ul.empty();
  // Attempt to parse the file
  let file = document.getElementById('import_file').files[0];
  if (file) {
    let reader = new FileReader();
    reader.readAsText(file, 'UTF-8');
    reader.onload = e => {
      $import_dialog_ul.empty();
      // Count the number of essays
      let num_essays = 0;
      if (e.target.result.trim() !== 'null') {
        let essays = JSON.parse(e.target.result.trim());
        for (let i = 0; i < essays.length; i++) {
          // Only count it as an essay if it has 3 elements
          num_essays += essays[i].length === 3;
          // Display the name of the essay
          $import_dialog_ul.append(`<li>${essays[i][1]}</li>`);
        }
      }
      // Enable the button only if we found essays
      $import_submit.prop('disabled', num_essays === 0);
      $num_found.text(num_essays);
    };
  }
});

$('#import_dialog form').on('submit', e => {
  e.preventDefault();
  // Attempt to parse the file
  let file = document.getElementById('import_file').files[0];
  if (file) {
    let reader = new FileReader();
    reader.readAsText(file, 'UTF-8');
    reader.onload = e => {
      if (e.target.result.trim() !== 'null') {
        let essays = JSON.parse(e.target.result.trim());
        // Load the essays that are already saved
        let saved_essays = JSON.parse(localStorage.getItem('saved_essays'));
        if (saved_essays === null) saved_essays = [];
        for (let i = 0; i < essays.length; i++) {
          if (essays[i].length === 3) {
            // Check if the essay's ID isn't part of the already saved essays
            let exists = false;
            for (let j = 0; j < saved_essays.length; j++) {
              if (saved_essays[j][0] === essays[i][0]) {
                exists = true;
                break;
              }
            }
            // Skip the essay if it already exists
            if (exists) continue;
            // Add the essay to the list of saved essays
            saved_essays.push([essays[i][0], essays[i][1]]);
            // Save the actual essay
            localStorage.setItem('essay' + essays[i][0], essays[i][2]);
          }
        }
        // Save the updated list of essays
        localStorage.setItem('saved_essays', JSON.stringify(saved_essays));
        $saved_ul.empty();
        if (saved_essays.length) {
          for (let i = 0; i < saved_essays.length; i++) {
            $saved_ul.append(`<li data-id="${saved_essays[i][0]}">${saved_essays[i][1]}</li>`);
          }
          $saved.show();
          handle_essay_selection();
        } else {
          $saved.hide();
        }
        $('#import_dialog').hide('slow', () => $('#import_dialog + .overlay').hide());
      } else {
        $import_submit.prop('disabled', true);
      }
    }
  } else {
    $import_submit.prop('disabled', true);
  }
});

//
// Generate the essay
//

$settings.submit(async e => {
  e.preventDefault();
  $generate.prop('disabled', true);

  const { data: {user} = {} } = await client.auth.getUser();

  // Set the direction of text
  $('body').toggleClass('vertical', localStorage.getItem('direction') !== 'horizontal');
  // Save the min and max preferences
  localStorage.setItem('min_essay', $min.val() || 1);
  localStorage.setItem('max_essay', $max.val() || 3);

  let { known_kanji, known_priority_kanji } = await get_known_kanji(user);

  $.post('/essay', {
    'min': $min.val() || 1,
    'max': $max.val() || 3,
    'known_kanji': [...known_kanji].join(''),
    'known_priority_kanji': [...known_priority_kanji].join(''),
  }, result => {
    $generate.prop('disabled', false);
    if (!result.length) {
      // If there were no results
      $('#no_results + .overlay').show();
      $('#no_results').show('slow');
    } else {
      $settings.hide();
      $saved.hide();
      // Show the generated essay
      for (let i = 0; i < result.length; i++) {
        let reading = result[i][3].split(',')[0];
        // Color code the ending character of the sentence
        let content = result[i][1];
        content = content.replace(/.$/, match => `<span class="divider">${match}</span>`);
        $essay.append(`<span data-id="${result[i][0]}" data-meaning="${result[i][2]}" data-reading="${reading}">${content}</span>`);
      }
      handle_essay_clicks();
      $('#info, #save, #essay, #direction').show();
    }
  }).fail(jqXHR => {
    if (jqXHR.status === 0) {
      $('#quiz_container').hide();
      $settings.html(
        'You\'re currently offline. Try reloading once you\'re connected to the internet.',
      ).show();
    } else {
      alert('Error code ' + jqXHR.status);
      $generate.prop('disabled', false);
    }
  });
});

//
// Report option
//

function show_reference(report_type) {
  $('#report_dialog span').text(report_type);
  if (report_type === 'translation') {
    $('#reference').text($('#meaning').text());
  } else if (report_type === 'question') {
    $('#reference').text($('#question').text());
  } else if (report_type === 'reading') {
    $('#reference').text($('#kana').text());
  }
}

$('#report_type button').on('click', function () {
  $('#report_type').removeAttr('open');
  $('#report_type summary').text($(this).text()).attr('data-value', $(this).attr('data-value'));
  show_reference($(this).attr('data-value'));
});

$('#report').on('click', () => {
  $('#report_dialog + .overlay').show();
  $('#report_dialog').show('slow');
  show_reference($('#report_dialog summary').attr('data-value'));
});

$('#report_dialog form').submit(e => {
  e.preventDefault();
  $report_dialog_button.prop('disabled', true);
  let id = $('#floating').attr('data-id');
  $.post('/report', {
    sentence_id: id,
    report_type: $('#report_type summary').attr('data-value'),
    suggested: $('#suggested').val().trim().length ? $('#suggested').val().trim() : undefined,
    comment: $('#comment').val().trim().length ? $('#comment').val().trim() : undefined,
  }).done(result => {
    $report_dialog_button.prop('disabled', false);
    if (result === 'success') {
      $('#report_dialog form').trigger('reset');
      $('#report_dialog').hide('slow', () => $('#report_dialog + .overlay').hide());
    } else {
      alert(result);
    }
  });
});

$('#save').on('click', () => {
  $('#save_dialog + .overlay').show();
  $('#save_dialog').show('slow');
  $('#essay_name').focus();
});

$('#save_dialog form').submit(async e => {
  e.preventDefault();
  let essay_name = $('#essay_name').val().trim();
  if (essay_name.length === 0) {
    alert('Please enter a name for the essay');
    return;
  }
  $save_dialog_button.prop('disabled', true);

  // Save the essay, then set the data-id attribute of the essay so that it can be unsaved
  $essay.data('id', await save_essay(essay_name, $essay.html()));

  $save_dialog_button.prop('disabled', false);
  $('#save_dialog form').trigger('reset');
  $('#save_dialog').hide('slow', () => $('#save_dialog + .overlay').hide());
  $('#saved_name').text(essay_name);
  $('#unsave, #saved_name, #save').toggle();
});

$('#unsave').on('click', async () => {
  $('#unsave, #saved_name, #save').toggle();
  await unsave_essay($essay.data('id'));
});

// Event handlers to close dialogs
$('dialog').each(function () {
  $(`#${this.id} .close, #${this.id} + .overlay`).on('click', () => {
    $(this).hide('slow', () => $(`#${this.id} + .overlay`).hide());
  });
});

// Pressing the enter key should go to the answer/next question if a quiz is going on
// Otherwise it should start the quiz
$(window).on('keypress', e => {
  if (e.key === 'Enter') {
    if ($settings.is(':visible')) {
      $generate.click();
    }
  }
});
