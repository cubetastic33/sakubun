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
