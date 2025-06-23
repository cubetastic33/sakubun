$('#signout').click(() => {
  $.post('/admin_signout').done(() => location.href = '/');
});

// Event handlers to close dialogs
$('dialog').each(function () {
  $(`#${this.id} .close, #${this.id} + .overlay`).click(() => {
    $(this).hide('slow', () => $(`#${this.id} + .overlay`).hide());
  });
});

$('.reject, .accept').click(function () {
  let is_report = $(this).parent().parent().parent().attr('id') === 'reports_cards';
  let dialog = $(this).hasClass('reject') ? 'confirmation' : is_report ? 'override' : 'edit_override';
  let id = $(this).parent().parent().attr('class');
  $(`#${dialog} + .overlay`).show();
  $(`#${dialog}`).attr('data-id', id).attr('data-type', is_report ? 'report' : 'override').show('slow');
  $(`#${dialog} .action`).text(is_report ? 'reject' : 'delete');
  $(`#${dialog} .template`).text(is_report ? 'report' : 'override');
  $(`#${dialog} :submit`).focus();
  if (is_report && $(this).hasClass('accept')) {
    $('#question').val($(this).parent().siblings('h2').text());
    for (let property of ['translation', 'reading']) {
      $(`#${property}`).val($(`#reports_cards .${id} .${property}:first-of-type`).text());
    }
    for (let property of ['report_type', 'comment']) {
      let value = $(`#reports_cards .${id} .${property}`).text();
      // Hide the comment div if there is no comment
      // This doesn't apply for report_type
      if (value.length) {
        $(`#${dialog} .${property}`).show();
        $(`#${property}`).text(value);
      } else {
        $(`#${dialog} .${property}`).hide();
      }
    }
    let suggested = $(`#reports_cards .${id} .suggested`).text();
    if (suggested.length) {
      $(`#${dialog} .suggested`).show();
      $('#suggested').text(suggested);
    } else {
      $(`#${dialog} .suggested`).hide();
    }
  } else if ($(this).hasClass('accept')) {
    $('#edit_override .question').text($(this).parent().siblings('h2').text());
    $('#edit_override .translation').text($(`#overrides_cards .${id} .translation`).text());
    $('#edit_override .reading').text($(`#overrides_cards .${id} .reading`).text());
    $('#edit_override .override_type').text($(`#overrides_cards .${id} .override_type`).text());
    $('#value').val($(`#overrides_cards .${id} .value`).text());
    $('#primary').prop('checked', !!$(`#overrides_cards .${id} .primary`).length);
  }
});

function alert_error(info, error) {
  console.log(info, error);
  // Only alert with the responseText if it's an internal server error
  // This is because 404 errors for example have HTML in the responseText
  alert(error.status === 500 ? error.responseText : "An error occurred");
}

$('#confirmation button:last-child').click(() => {
  $('#confirmation button').prop('disabled', true);
  const delete_type = $('#confirmation').attr('data-type');
  $.post('/delete_' + delete_type, {
    value: $('#confirmation').attr('data-id'),
  }).done(result => {
    console.log(result);
    if (result === 'success') {
      location.reload();
    } else {
      alert(result);
      $('#confirmation button').prop('disabled', false);
    }
  }).fail(error => {
    alert_error("Failed /delete_" + delete_type, error);
    $('#confirmation button').prop('disabled', false);
  });
});

$('#override form').submit(e => {
  e.preventDefault();
  $('#override button').prop('disabled', true);
  let additional_reading = $('#additional_reading').val().trim();
  $.post('/add_override', {
    report_id: $('#override').attr('data-id'),
    question: $('#question').val().trim(),
    translation: $('#translation').val().trim(),
    reading: $('#reading').val().trim(),
    additional_reading: additional_reading.length ? additional_reading : undefined,
  }).done(result => {
    console.log(result);
    if (result === 'success') {
      location.reload();
    } else {
      alert(result);
      $('#override button').prop('disabled', false);
    }
  }).fail(error => {
    alert_error("Failed /add_override", error);
    $('#override button').prop('disabled', false);
  });
});

$('#edit_override form').submit(e => {
  e.preventDefault();
  $('#edit_override button').prop('disabled', true);
  let override_id = $('#edit_override').attr('data-id');
  $.post('/edit_override', {
    override_id: override_id,
    value: $('#value').val().trim(),
    primary_value: $('#primary').is(':checked'),
  }).done(result => {
    console.log(result);
    if (result === 'success') {
      location.reload();
    } else {
      alert(result);
      $('#edit_override button').prop('disabled', false);
    }
  }).fail(error => {
    alert_error("Failed /edit_override", error.responseText);
    $('#edit_override button').prop('disabled', false);
  });
});

function mark_reading(question_html, kana_html) {
  const kanji_diff = patienceDiff(question_html.split(''), kana_html.split(''));
  // Iterate over the diff in reverse so the indices are still valid
  for (let i = kanji_diff.lines.length - 1; i >= 0; i--) {
    const kanji_index = kanji_diff.lines[i].aIndex;
    const kana_index = kanji_diff.lines[i].bIndex;
    // If this diff refers to the kanji
    if (kana_index === -1) {
      question_html = question_html.slice(0, kanji_index + 1) + '</span>' + question_html.slice(kanji_index + 1);
      question_html = question_html.slice(0, kanji_index) + '<span class="marked-reading">' + question_html.slice(kanji_index);
    }
    // If this diff refers to the kana
    if (kanji_index === -1) {
      kana_html = kana_html.slice(0, kana_index + 1) + '</span>' + kana_html.slice(kana_index + 1);
      kana_html = kana_html.slice(0, kana_index) + '<span class="marked-reading">' + kana_html.slice(kana_index);
    }
  }
  return [question_html, kana_html];
}

// Mark readings in all the reports
$('#reports_cards > div').each(function () {
  const $question = $(this).children('h2');
  const $reading = $('.reading', this);
  const question = $question.html();
  console.log('here');
  const [marked_question, marked_reading] = mark_reading(question, $reading.html());
  $question.html(marked_question);
  $reading.html(marked_reading);
  if ($('.report_type', this).text() === 'reading') {
    console.log($('.report_type', this).text());
    const $suggested = $('.suggested', this);
    if ($suggested.html()) $suggested.html(mark_reading(question, $suggested.html())[1]);
  }
});