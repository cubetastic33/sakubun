// Commonly used selectors
const $min = $('#min');
const $max = $('#max');
const $show_textbox = $('#show_textbox');
const $show_reading = $('#show_reading');
const $show_diff = $('#show_diff');
const $settings = $('#settings');
const $diff_checkbox = $('#diff_checkbox');
const $question_no = $('#question_no');
const $question = $('#question');
const $answer = $('#answer');
const $evaluation = $('#evaluation');
const $kana = $('#kana');
const $meaning = $('#meaning');
const $report = $('#report');
const $next = $('#next');

async function get_known_kanji() {
  const { data: {session} } = await client.auth.getSession();
  if (session) {
    let { data } = await client.from('known_kanji').select('known_kanji, known_priority_kanji').eq('user_id', session.user.id);
    return {
      known_kanji: new Set(data.length ? data[0].known_kanji : []),
      known_priority_kanji: new Set(data.length ? data[0].known_priority_kanji : []),
    };
  } else return {
    known_kanji: new Set(localStorage.getItem('known_kanji')),
    known_priority_kanji: new Set(localStorage.getItem('known_priority_kanji')),
  };
}

async function init_quiz_settings() {
  // This function is called from setAuthView() in streaks.js
  ({ known_kanji, known_priority_kanji } = await get_known_kanji());

  if (!known_kanji.size) {
    $('#settings *:not(.container):not(.always):not(.always *)').hide();
    $('#range').html(
      'Note: You haven\'t chosen any known kanji yet, so the quiz questions will consist only of '
      + 'kana<br><br>',
    );
    localStorage.removeItem('show_reading');
    localStorage.removeItem('show_diff');
  } else {
    // Set the default values for min and max based on the number of kanji added
    $min[0].setAttribute('value', Math.min(3, known_kanji.size));
    $max[0].setAttribute('value', Math.min(15, known_kanji.size));
  }

  // Restore settings from localStorage
  let settings_min = localStorage.getItem('min');
  let settings_max = localStorage.getItem('max');
  let settings_textbox = localStorage.getItem('show_textbox');
  let settings_reading = localStorage.getItem('show_reading');
  let settings_diff = localStorage.getItem('show_diff');

  if (settings_min) $min.val(settings_min);
  if (settings_max) $max.val(settings_max);
  if (settings_textbox) $show_textbox.prop('checked', settings_textbox === 'true');
  if (settings_reading) $show_reading.prop('checked', settings_reading === 'true');
  if (settings_diff) $show_diff.prop('checked', settings_diff === 'true');
  $max.prop('min', $min.val());
  $min.prop('max', $max.val());

  if ($max.val() === '0') $('#settings *:not(.container):not(.always):not(.always *)').hide();

  warning();
  $('#loading').hide();
  $settings.show();
}

let known_kanji, known_priority_kanji;

function show_reading() {
  // Returns whether the reading should be displayed or not
  return known_kanji.size && $max.val() != 0 && $show_reading.is(':checked');
}

function should_evaluate() {
  // Returns whether evaluation is required or not
  return known_kanji.size && $max.val() != 0 && $show_textbox.is(':checked');
}

function show_diff() {
  // Returns whether to mark the kanji diff or not
  return known_kanji.size && $max.val() != 0 && !$show_textbox.is(':checked') && $show_diff.is(':checked');
}

function warning(e) {
  // Save the setting only if this is run as a callback
  if (e) localStorage.setItem('show_reading', $show_reading.is(':checked'));
  // Show the "Mark difference" checkbox depending on the conditions
  $diff_checkbox.toggle(!should_evaluate() && show_reading());
  if (show_reading()) {
    // Show the warning that readings are unreliable
    $('.warning').show();
  } else {
    $('.warning').hide();
  }
}

$show_textbox.change(() => {
  localStorage.setItem('show_textbox', $show_textbox.is(':checked'));
  // Show the "Mark difference" checkbox depending on the conditions
  $diff_checkbox.toggle(!should_evaluate() && show_reading());
});
$show_reading.change(warning);
$show_diff.change(() => localStorage.setItem('show_diff', $show_diff.is(':checked')));
$min.change(function () {
  localStorage.setItem('min', $(this).val());
  $max.prop('min', $(this).val());
});
$max.change(function () {
  localStorage.setItem('max', $(this).val());
  $min.prop('max', $(this).val());

  if ($max.val() == 0) {
    // There aren't going to be any kanji in the questions
    $('#settings *:not(.container):not(.always):not(.always *)').hide();
  } else {
    $('#settings *:not(.container):not(.always):not(.always *)').show();
    settings_textbox = localStorage.getItem('show_textbox');
    if (settings_textbox) $show_textbox.prop('checked', settings_textbox == 'true');
    if ($show_reading.is(':checked')) $('.warning').show();
    $diff_checkbox.toggle(!should_evaluate() && show_reading());
  }
});

// Should only be true the first time get_questions() is run
let init = true;

function show_quiz() {
  $settings.hide();
  $('#quiz_container').show();
  // Clear input
  $('#meaning, #kana').empty();
  $evaluation.hide().attr('class', '');
  if ($show_textbox.is(':checked')) {
    $answer.val('').show().focus();
  } else {
    $answer.remove();
  }
  resize_answer_box();
  $next.text('Show Answer').prop('disabled', false);
  $report.hide();
}

async function questions_today() {
  // Returns the number of questions done today
  return (await get_days_learnt())[numerify(new Date())] || 0;
}

async function increment_questions() {
  // Increments the number of questions done today
  let days_learnt = await get_days_learnt();
  days_learnt[numerify(new Date())] = (days_learnt[numerify(new Date())] || 0) + 1;
  await set_days_learnt(days_learnt);
}

async function get_questions() {
  let { known_kanji } = await get_known_kanji();

  $.post('/sentences', {
    'min': known_kanji.size ? $min.val() || 0 : 0,
    'max': known_kanji.size ? $max.val() || 0 : 0,
    'known_kanji': [...known_kanji].join(''),
    'known_priority_kanji': [...known_priority_kanji].join(''),
  }, async result => {
    if (!result.length) {
      // If there were no results
      $('#start_quiz').prop('disabled', false);
      $('#quiz_container').hide();
      $settings.show();
      $('#no_results + .overlay').show();
      $('#no_results').show('slow');
    } else {
      // Show the question
      $('#quiz').attr('data-sentences', result);
      $('#quiz').attr('data-index', 0);
      $question.text(result.split('~')[1]);
      $question_no.text('Question ' + (await questions_today() + 1));
      if (init) {
        // Basic IME
        wanakana.bind($answer[0]);
        if (show_reading()) {
          $kana.show();
          show_quiz();
        } else {
          $kana.hide();
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
      $settings.html(
        'You\'re currently offline. Try reloading once you\'re connected to the internet.',
      ).show();
    } else {
      alert('Error code ' + jqXHR.status);
      $('#start_quiz').prop('disabled', false);
    }
  });
}

$settings.submit(async e => {
  e.preventDefault();
  $('#start_quiz, #next').prop('disabled', true);
  // Get questions from the server
  await get_questions();
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
    text = text.replaceAll(katakana[i], hiragana[i]);
  }
  return text;
}

$('#quiz_container').submit(async e => {
  e.preventDefault();
  $next.prop('disabled', true);
  let sentences = $('#quiz').attr('data-sentences').split('|');
  let index = $('#quiz').attr('data-index');
  if ($next.text() === 'Show Answer') {
    // Show the answer
    let eng_sentence = sentences[index].split('~')[2];
    let readings = sentences[index].split('~')[3].split(',');
    $meaning.text(eng_sentence);
    $next.text('Next').prop('disabled', false);
    // Show the report button
    $report.show();
    if (should_evaluate()) {
      // Check if answer was right
      // Replace the textarea with a div so we can use span tags in the text
      $evaluation.text($answer.val()).show();
      $answer.hide();
      // First display the primary reading
      $kana.text(readings[0]);
      let punct = /[、。！？・「」『』]/ug;
      let answer = convert_to_hiragana($answer.val());

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
          $evaluation.attr('class', 'correct');
          // Replace the shown reading with this one
          $kana.text(readings[i]);
          break;
        } else if (!closest_diff || score > closest_diff[0]) {
          // The diff stored in `closest_diff` should include punctuation, so that the
          // indices will match
          $kana.text(readings[i]);
          closest_diff = [score, patienceDiff(answer.split(''), reading.split(''))];
          console.log(patienceDiff(answer.split(''), reading.split('')));
        }
      }
      // If the user provided an answer but it didn't match with any of the readings
      if ($answer.val().length && !$evaluation.hasClass('correct')) {
        $evaluation.attr('class', 'incorrect');
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
            html = html.slice(0, indices[j]) + `<span class="${class_name}">` + html.slice(indices[j]);
          }
          $('#' + ['evaluation', 'kana'][i]).html(html);
        }
      }
    } else if (show_reading()) {
      // Show the evaluation div so there's a horizontal divider
      $evaluation.show();
      // Display the primary reading
      $kana.text(readings[0]);
      if (show_diff()) {
        // Find the readings of the kanji so we can mark them
        let question_html = $question.html();
        let kana_html = $kana.html();
        let kanji_diff = patienceDiff(question_html.split(''), kana_html.split(''));
        // Iterate over the diff in reverse so the indices are still valid
        for (let i = kanji_diff.lines.length - 1; i >= 0; i--) {
          const kanji_index = kanji_diff.lines[i].aIndex;
          const kana_index = kanji_diff.lines[i].bIndex;
          // If this diff refers to the kanji
          if (kana_index === -1) {
            question_html = question_html.slice(0, kanji_index + 1) + '</span>' + question_html.slice(kanji_index + 1);
            question_html = question_html.slice(0, kanji_index) + '<span class="reading">' + question_html.slice(kanji_index);
          }
          // If this diff refers to the kana
          if (kanji_index === -1) {
            kana_html = kana_html.slice(0, kana_index + 1) + '</span>' + kana_html.slice(kana_index + 1);
            kana_html = kana_html.slice(0, kana_index) + '<span class="reading">' + kana_html.slice(kana_index);
          }
        }
        $question.html(question_html);
        $kana.html(kana_html);
      }
    }
    // We've finished a question so increment the question number
    await increment_questions();
  } else {
    // Go to the next question
    index++;
    if (index < sentences.length) {
      $('#quiz').attr('data-index', index);
      $question_no.text('Question ' + (parseInt($question_no.text().split(' ')[1]) + 1));
      // Display the question
      $question.text(sentences[index].split('~')[1]);
      $('#meaning, #kana').empty();
      $evaluation.attr('class', '').hide();
      $answer.val('').show().focus();
      resize_answer_box();
      $next.text('Show Answer').prop('disabled', false);
      $report.hide();
    } else {
      // We've run out of questions, so fetch new ones
      await get_questions();
    }
  }
});

// Report option
function show_reference(report_type) {
  $('#report_dialog span').text(report_type);
  if (report_type === 'translation') {
    $('#reference').text($meaning.text());
  } else if (report_type === 'question') {
    $('#reference').text($question.text());
  } else if (report_type === 'reading') {
    $('#reference').text($kana.text());
    $('#suggested').val($answer.val());
  }
}

$('#report_type button').click(function () {
  $('#report_type').removeAttr('open');
  $('#report_type summary').text($(this).text()).attr('data-value', $(this).attr('data-value'));
  show_reference($(this).attr('data-value'));
});

$report.on('click', () => {
  $('#report_dialog + .overlay').show();
  $('#report_dialog').attr('class', show_reading() ? '' : 'no_evaluate').show('slow');
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
      $('#report_dialog').hide('slow', () => $('#report_dialog + .overlay').hide());
    } else {
      alert(result);
    }
  }).fail(error => {
    console.error(error);
    alert(error.responseText);
    $('#report_dialog button').prop('disabled', false);
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
  if (!$show_textbox.is(':checked')) return;
  let elem = $answer[0];
  $(elem).css('height', 'auto');
  $(elem).css('height', elem.scrollHeight + 'px');
}

$answer.on('input', resize_answer_box);
$(window).resize(resize_answer_box);

// Pressing the enter key should go to the answer/next question if a quiz is going on
// Otherwise it should start the quiz
$(window).keypress(e => {
  if (e.key === 'Enter') {
    if ($next.is(':visible')) {
      e.preventDefault();
      $next.click();
    } else if ($('#start_quiz').is(':visible')) {
      $('#start_quiz').click();
    }
  }
});
