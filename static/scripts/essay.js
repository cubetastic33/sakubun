// Commonly used selectors
const $vertical = $('#vertical');
const $saved = $('#saved');
const $saved_ul = $('#saved ul');
const $settings = $('#settings');
const $generate = $('#generate');
const $vertical_text = $('#vertical_text');
const $min = $('#min');
const $max = $('#max');
const $essay = $('#essay');
const $report_dialog_button = $('#report_dialog button');
const $save_dialog_button = $('#save_dialog button');
const $num_found = $('#num_found');
const $import_dialog_ul = $('#import_dialog ul');
const $import_submit = $('#import_submit');

let known_kanji = new Set(localStorage.getItem('known_kanji'));

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

  let saved_essays = JSON.parse(localStorage.getItem('saved_essays'));
  if (saved_essays && saved_essays.length) {
    for (let i = 0; i < saved_essays.length; i++) {
      $saved_ul.append(`<li data-timestamp="${saved_essays[i][0]}">${saved_essays[i][1]}</li>`);
    }
  } else {
    $saved.hide();
  }
}

//
// Restore settings from localStorage
//

let vertical_text = localStorage.getItem('vertical_text');
let settings_min = localStorage.getItem('min_essay');
let settings_max = localStorage.getItem('max_essay');


// vertical_text is a string so 'false' is truthy; so compare with 'false' instead
// This way if the setting is unset it'll still be considered as true
if (vertical_text !== 'false') $essay.addClass('vertical');
$vertical_text.prop('checked', vertical_text !== 'false');

if (settings_min) $min.val(settings_min);
if (settings_max) $max.val(settings_max);
$max.prop('min', $min.val());
$min.prop('max', $max.val());

function handle_essay_clicks() {
  // Add click handlers to the essay sentences
  $('#essay > span').on('click', function () {
    $('#floating section').html(`
            <b>Sentence:</b> <span id="question">${this.innerText}</span><br>
            <b>Reading:</b> <span id="kana">${this.dataset.reading}</span><br>
            <b>Meaning:</b> <span id="meaning">${this.dataset.meaning}</span>
        `).parent().attr('data-id', this.dataset.id).show('slow');
    // Focus the close button so pressing enter closes the dialog
    $('#floating .close').focus();
  });
}

function handle_essay_selection() {
  // Add click handlers to allow selection of an essay
  $('#saved li').on('click', function () {
    $settings.hide();
    $saved.hide();
    $vertical.hide();
    $('#redirectBanner').hide();
    // Save the vertical text preference
    if ($vertical_text.prop('checked').toString() !== localStorage.getItem('vertical_text')) {
      localStorage.setItem('vertical_text', $vertical_text.prop('checked'));
      $essay.toggleClass('vertical', $vertical_text.prop('checked'));
    }
    // Show the saved essay
    $essay
      .html(localStorage.getItem('essay' + this.dataset.timestamp))
      .data('timestamp', this.dataset.timestamp)
      .show();
    $('#saved_name').text(this.innerText);
    handle_essay_clicks();
    $('#info, #unsave, #saved_name').show();
  });
}

handle_essay_selection();

//
// Export saved essays
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
// Import essays from file
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
            // Check if the essay's timestamp isn't part of the already saved essays
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
            $saved_ul.append(`<li data-timestamp="${saved_essays[i][0]}">${saved_essays[i][1]}</li>`);
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

$settings.submit(e => {
  e.preventDefault();
  $generate.prop('disabled', true);

  // Save the vertical text preference
  if ($vertical_text.prop('checked').toString() !== localStorage.getItem('vertical_text')) {
    localStorage.setItem('vertical_text', $vertical_text.prop('checked'));
    $essay.toggleClass('vertical', $vertical_text.prop('checked'));
  }
  // Save the min and max preferences
  localStorage.setItem('min_essay', $min.val() || 1);
  localStorage.setItem('max_essay', $max.val() || 3);

  let known_kanji = new Set(localStorage.getItem('known_kanji'));

  $.post('/essay', {
    'min': $min.val() || 1,
    'max': $max.val() || 3,
    'known_kanji': [...known_kanji].join(''),
  }, result => {
    // Analytics
    // pa is undefined when ad blockers block the microanalytics script
    if (typeof pa !== 'undefined') pa.track({name: 'essay'});
    $generate.prop('disabled', false);
    if (!result.length) {
      // If there were no results
      $('#no_results + .overlay').show();
      $('#no_results').show('slow');
    } else {
      $settings.hide();
      $saved.hide();
      $vertical.hide();
      $('#redirectBanner').hide();
      // Show the generated essay
      for (let i = 0; i < result.length; i++) {
        let reading = result[i][3].split(',')[0];
        // Color code the ending character of the sentence
        let content = result[i][1];
        content = content.replace(/.$/, match => `<span class="divider">${match}</span>`);
        $essay.append(`<span data-id="${result[i][0]}" data-meaning="${result[i][2]}" data-reading="${reading}">${content}</span>`);
      }
      handle_essay_clicks();
      $('#info, #save, #essay').show();
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

$('#save_dialog form').submit(e => {
  e.preventDefault();
  let essay_name = $('#essay_name').val().trim();
  if (essay_name.length === 0) {
    alert('Please enter a name for the essay');
    return;
  }
  $save_dialog_button.prop('disabled', true);

  // Add the essay to the list of saved essays
  let saved_essays = JSON.parse(localStorage.getItem('saved_essays'));
  if (saved_essays === null) saved_essays = [];
  const timestamp = Date.now();
  saved_essays.push([timestamp, essay_name]);
  localStorage.setItem('saved_essays', JSON.stringify(saved_essays));
  // Save the actual essay
  localStorage.setItem('essay' + timestamp, $essay.html());
  // Set the data-timestamp attribute of the essay so that it can be unsaved
  $essay.data('timestamp', timestamp);

  $save_dialog_button.prop('disabled', false);
  $('#save_dialog form').trigger('reset');
  $('#save_dialog').hide('slow', () => $('#save_dialog + .overlay').hide());
  $('#saved_name').text(essay_name);
  $('#unsave, #saved_name, #save').toggle();
});

$('#unsave').on('click', () => {
  $('#unsave, #saved_name, #save').toggle();
  let saved_essays = JSON.parse(localStorage.getItem('saved_essays'));
  if (saved_essays === null) return; // Happens when the essay was deleted from a different tab
  const timestamp = $essay.data('timestamp');
  for (let i = 0; i < saved_essays.length; i++) {
    if (saved_essays[i][0].toString() === timestamp.toString()) {
      // Remove this essay from the saved essays list
      saved_essays.splice(i, 1);
      // Remove the saved essay itself
      localStorage.removeItem('essay' + timestamp);
      localStorage.setItem('saved_essays', JSON.stringify(saved_essays));
      return;
    }
  }
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
