function should_evaluate() {
  // Returns whether evaluation is required or not
  return known_kanji.size && $('#max').val() != 0 && $('#evaluate').is(':checked');
}

let known_kanji = new Set(localStorage.getItem('known_kanji'));
let known_priority_kanji = new Set(localStorage.getItem('known_priority_kanji'));

if (!known_kanji.size) {
  $('#settings *:not(.container):not(.always):not(.always *)').hide();
  $('#range').html(
    'Note: You haven\'t chosen any known kanji yet, so the quiz questions will consist only of '
    + 'kana<br><br>',
  );
  localStorage.removeItem('evaluate');
} else {
  // Set the default values for min and max based on the number of kanji added
  $('#min')[0].setAttribute('value', Math.min(3, known_kanji.size));
  $('#max')[0].setAttribute('value', Math.min(15, known_kanji.size));
}

// Restore settings from localStorage
let settings_min = localStorage.getItem('min');
let settings_max = localStorage.getItem('max');
let settings_textbox = localStorage.getItem('textbox');
let settings_evaluate = localStorage.getItem('evaluate');

if (settings_min) $('#min').val(settings_min);
if (settings_max) $('#max').val(settings_max);
if (settings_textbox) $('#textbox').prop('checked', settings_textbox == 'true');
if (settings_evaluate) $('#evaluate').prop('checked', settings_evaluate == 'true');
$('#max').prop('min', $('#min').val());
$('#min').prop('max', $('#max').val());

if ($('#max').val() == 0) {
  $('#evaluate').prop('checked', false);
  $('#settings .container, #settings .container ~ br').hide();
}

function warning(e) {
  // Save the setting only if this is run as a callback
  if (e) localStorage.setItem('evaluate', $('#evaluate').is(':checked'));
  if (should_evaluate()) {
    $('.warning').show();
  } else {
    $('.warning').hide();
  }
}

warning();
$('#settings').show();
$('#textbox').change(() => {
  localStorage.setItem('textbox', $('#textbox').is(':checked'));
});
$('#evaluate').change(warning);
$('#min').change(function () {
  localStorage.setItem('min', $(this).val());
  $('#max').prop('min', $(this).val());
});
$('#max').change(function () {
  localStorage.setItem('max', $(this).val());
  $('#min').prop('max', $(this).val());

  if ($('#max').val() == 0) {
    $('#settings .container, #settings .container ~ br').hide();
    if ($('#evaluate').is(':checked')) {
      $('.warning').hide();
    }
  } else {
    $('#settings .container, #settings .container ~ br').show();
    settings_evaluate = localStorage.getItem('evaluate');
    if (settings_evaluate) $('#evaluate').prop('checked', settings_evaluate == 'true');
    if ($('#evaluate').is(':checked')) {
      $('.warning').show();
    }
  }
});

// Should only be true the first time get_questions() is run
let init = true;

function show_quiz() {
  $('#settings').hide();
  $('#quiz_container').show();
  // Clear input
  $('#meaning, #kana').empty();
  $('#evaluation').hide().attr('class', '');
  if ($('#textbox').is(':checked')) {
    $('#answer').val('').show().focus();
  } else {
    $('#answer').remove();
  }
  resize_answer_box();
  $('#next').text('Show Answer').prop('disabled', false);
  $('#report').hide();
}

function get_questions() {
  let known_kanji = new Set(localStorage.getItem('known_kanji'));

  $.post('/sentences', {
    'min': $('#min').val() || 0,
    'max': $('#max').val() || 0,
    'known_kanji': [...known_kanji].join(''),
    'known_priority_kanji': [...known_priority_kanji].join(''),
  }, result => {
    if (!result.length) {
      // If there were no results
      $('#start_quiz').prop('disabled', false);
      $('#quiz_container').hide();
      $('#settings').show();
      $('#no_results + .overlay').show();
      $('#no_results').show('slow');
    } else {
      // Show the question
      $('#quiz').attr('data-sentences', result);
      $('#quiz').attr('data-index', 0);
      $('#question').text(result.split('~')[1]);
      if (init) {
        // Basic IME
        wanakana.bind($('#answer')[0]);
        if (should_evaluate()) {
          $('#kana').show();
          show_quiz();
        } else {
          $('#kana').hide();
          show_quiz();
        }
        init = false;
      } else {
        // Reset answer
        show_quiz();
      }
    }
  }).fail(jqXHR => {
    if (jqXHR.status === 0) {
      $('#quiz_container').hide();
      $('#settings').html(
        'You\'re currently offline. Try reloading once you\'re connected to the internet.',
      ).show();
    } else {
      alert('Error code ' + jqXHR.status);
      $('#start_quiz').prop('disabled', false);
    }
  });
}

$('#settings').submit(e => {
  e.preventDefault();
  $('#start_quiz, #next').prop('disabled', true);
  // Get questions from the server
  get_questions();
});

// Colors
$('#palette').click(() => {
  $('#colors + .overlay').show();
  $('#colors').show('slow');
});

function set_colors() {
  let properties = {
    'wrong_color': '--wrong',
    'missing_color': '--missing',
    'wrong_underline': '--wrong-underline',
    'missing_underline': '--missing-underline',
  };
  for (let i = 0; i < Object.keys(properties).length; i++) {
    let property_name = Object.keys(properties)[i];
    if (localStorage.getItem(property_name)) {
      document.documentElement.style.setProperty(
        properties[property_name],
        localStorage.getItem(property_name),
      );
    }
  }

  $('#wrong_color').val(getComputedStyle(document.documentElement).getPropertyValue('--wrong').trim());
  $('#missing_color').val(getComputedStyle(document.documentElement).getPropertyValue('--missing').trim());
  $('#wrong_underline').prop('checked', getComputedStyle(document.documentElement).getPropertyValue('--wrong-underline').trim() !== 'none');
  $('#missing_underline').prop('checked', getComputedStyle(document.documentElement).getPropertyValue('--missing-underline').trim() !== 'none');
}

set_colors();

$('#wrong_color, #missing_color').change(function () {
  console.log($(this).val());
  localStorage.setItem(this.id, $(this).val());
  set_colors();
});

$('#wrong_underline, #missing_underline').change(function () {
  localStorage.setItem(this.id, $(this).is(':checked') ? `1px solid var(--${this.id.split('_')[0]})` : 'none');
  set_colors();
});

$('#reset_colors').click(() => {
  localStorage.removeItem('wrong_color');
  localStorage.removeItem('missing_color');
  localStorage.removeItem('wrong_underline');
  localStorage.removeItem('missing_underline');
  document.documentElement.style.setProperty('--wrong', getComputedStyle(document.documentElement).getPropertyValue('--error').trim());
  document.documentElement.style.setProperty('--missing', getComputedStyle(document.documentElement).getPropertyValue('--success').trim());
  document.documentElement.style.setProperty('--wrong-underline', 'none');
  document.documentElement.style.setProperty('--missing-underline', 'none');
  set_colors();
});

const hiragana = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ';
const katakana = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ';

function convert_to_hiragana(text) {
  // Converts katakana to hiragana
  for (let i = 0; i < katakana.length; i++) {
    text.replaceAll(katakana[i], hiragana[i]);
  }
  return text;
}

$('#quiz_container').submit(e => {
  e.preventDefault();
  $('#next').prop('disabled', true);
  let sentences = $('#quiz').attr('data-sentences').split('|');
  let index = $('#quiz').attr('data-index');
  if ($('#next').text() === 'Show Answer') {
    // Show the answer
    let eng_sentence = sentences[index].split('~')[2];
    let readings = sentences[index].split('~')[3].split(',');
    $('#meaning').text(eng_sentence);
    $('#next').text('Next').prop('disabled', false);
    // Show the report button
    $('#report').show();
    if (should_evaluate()) {
      // Check if answer was right
      // Replace the textarea with a div so we can use span tags in the text
      $('#evaluation').text($('#answer').val()).show();
      $('#answer').hide();
      // First display the primary reading
      $('#kana').text(readings[0]);
      let punct = /[、。！？・「」『』]/ug;
      let answer = convert_to_hiragana($('#answer').val());

      // Find the reading closest to the one the user wrote
      let closest_diff;
      for (let i = 0; i < readings.length; i++) {
        let reading = convert_to_hiragana(readings[i]);

        // How well the answer matches
        let intersection = [];
        for (letter of answer.replace(punct, '')) {
          if (reading.replace(punct, '').includes(letter)) intersection.push(letter);
        }
        let score = intersection.length;

        // If the answer is an exact match
        if (answer.replace(punct, '') === reading.replace(punct, '')) {
          $('#evaluation').attr('class', 'correct');
          // Replace the shown reading with this one
          $('#kana').text(readings[i]);
          break;
        } else if (!closest_diff || score > closest_diff[0]) {
          // The diff stored in `closest_diff` should include punctuation, so that the
          // indices will match
          $('#kana').text(readings[i]);
          closest_diff = [score, patienceDiff(answer.split(''), reading.split(''))];
          console.log(patienceDiff(answer.split(''), reading.split('')));
        }
      }
      // If the user provided an answer but it didn't match with any of the readings
      if ($('#answer').val().length && !$('#evaluation').hasClass('correct')) {
        $('#evaluation').attr('class', 'incorrect');
        let wrong = [];
        let missing = [];
        for (let i = closest_diff[1].lines.length - 1; i >= 0; i--) {
          // Don't count punctuation
          if (closest_diff[1].lines[i].line.match(punct)) {
            continue;
          }
          // This character was part of the user's answer but not the actual reading
          if (closest_diff[1].lines[i].bIndex === -1) {
            wrong.push(closest_diff[1].lines[i].aIndex);
          }
          // This character is part of the actual reading but not the user's answer
          if (closest_diff[1].lines[i].aIndex === -1) {
            missing.push(closest_diff[1].lines[i].bIndex);
          }
        }
        // Mark the differences
        for (let i = 0; i < 2; i++) {
          let html = $('#' + ['evaluation', 'kana'][i]).html();
          let indices = [wrong, missing][i];
          let class_name = ['wrong', 'missing'][i];
          for (let j = 0; j < indices.length; j++) {
            html = html.slice(0, indices[j] + 1) + '</span>' + html.slice(indices[j] + 1);
            html = html.slice(0, indices[j]) + `<span class=\"${class_name}\">` + html.slice(indices[j]);
          }
          $('#' + ['evaluation', 'kana'][i]).html(html);
        }
      }
    }
  } else {
    // Go to the next question
    index++;
    if (index < sentences.length) {
      $('#quiz').attr('data-index', index);
      $('#question').text(sentences[index].split('~')[1]);
      $('#meaning, #kana').empty();
      $('#evaluation').attr('class', '').hide();
      $('#answer').val('').show().focus();
      resize_answer_box();
      $('#next').text('Show Answer').prop('disabled', false);
      $('#report').hide();
    } else {
      // We've run out of questions, so fetch new ones
      get_questions();
    }
  }
});

// Report option
function show_reference(report_type) {
  $('#report_dialog span').text(report_type);
  if (report_type === 'translation') {
    $('#reference').text($('#meaning').text());
  } else if (report_type === 'question') {
    $('#reference').text($('#question').text());
  } else if (report_type === 'reading') {
    $('#reference').text($('#kana').text());
    $('#suggested').val($('#answer').val());
  }
}

$('#report_type button').click(function () {
  $('#report_type').removeAttr('open');
  $('#report_type summary').text($(this).text()).attr('data-value', $(this).attr('data-value'));
  show_reference($(this).attr('data-value'));
});

$('#report').on('click', () => {
  $('#report_dialog + .overlay').show();
  $('#report_dialog').attr('class', should_evaluate() ? '' : 'no_evaluate').show('slow');
  show_reference($('#report_dialog summary').attr('data-value'));
});

$('#report_dialog form').submit(e => {
  e.preventDefault();
  $('#report_dialog button').prop('disabled', true);
  let id = $('#quiz').attr('data-sentences').split('|')[$('#quiz').attr('data-index')].split('~')[0];
  $.post('/report', {
    sentence_id: id,
    report_type: $('#report_type summary').attr('data-value'),
    suggested: $('#suggested').val().trim().length ? $('#suggested').val().trim() : undefined,
    comment: $('#comment').val().trim().length ? $('#comment').val().trim() : undefined,
  }).done(result => {
    $('#report_dialog button').prop('disabled', false);
    if (result === 'success') {
      $('#report_dialog form').trigger('reset');
      $('#report_dialog').hide('slow').then($('#report_dialog + .overlay').hide());
    } else {
      alert(result);
    }
  });
});

// Event handlers to close dialogs
$('dialog').each(function () {
  $(`#${this.id} .close, #${this.id} + .overlay`).click(() => {
    $(this).hide('slow', () => $(`#${this.id} + .overlay`).hide());
  });
});

// Auto-resize height of answer box
function resize_answer_box() {
  if (!$('#textbox').is(':checked')) return;
  let elem = $('#answer')[0];
  $(elem).css('height', 'auto');
  $(elem).css('height', elem.scrollHeight + 'px');
}

$('#answer').on('input', resize_answer_box);
$(window).resize(resize_answer_box);

// Pressing the enter key should go to the answer/next question if a quiz is going on
// Otherwise it should start the quiz
$(window).keypress(e => {
  if (e.key === 'Enter') {
    if ($('#next').is(':visible')) {
      e.preventDefault();
      $('#next').click();
    } else if ($('#start_quiz').is(':visible')) {
      $('#start_quiz').click();
    }
  }
});
