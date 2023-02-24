const ds = new DragSelect({
  area: document.querySelector('#kanji'),
  draggability: false,
  immediateDrag: false,
  dragKeys: {'up': [], 'right': [], 'down': [], 'left': []},
  selectedClass: 'selected',
});

ds.subscribe('callback', ({items}) => {
  if (items.length) {
    $('#button_overlay').css('display', 'flex');
  } else {
    $('#button_overlay').hide();
  }
});

const preview_ds = new DragSelect({
  area: document.querySelector('#preview_kanji'),
  draggability: false,
  immediateDrag: false,
  dragKeys: {'up': [], 'right': [], 'down': [], 'left': []},
  selectedClass: 'selected',
});

preview_ds.subscribe('callback', ({items}) => {
  if (items.length) {
    $('#preview_button_overlay').css('display', 'flex');
  } else {
    $('#preview_button_overlay').hide();
  }
});

function kanji_grid() {
  const $kanji = $('#kanji');

  // Remove any previously added selectables
  ds.removeSelectables(document.querySelectorAll('#kanji .selectable'));
  // Reset the grid
  $kanji.empty();
  $('#button_overlay').hide();

  // Show the number of kanji added
  let known_kanji = localStorage.getItem('known_kanji') || '';
  $('#num_known').text(known_kanji.length);
  let known_priority_kanji = localStorage.getItem('known_priority_kanji') || '';

  // Fill the kanji grid
  for (let i = 0; i < known_priority_kanji.length; i++) {
    $kanji.append(`<div class="selectable priority">${known_priority_kanji[i]}</div>`);
  }
  for (let i = 0; i < known_kanji.length; i++) {
    if (known_priority_kanji.includes(known_kanji[i])) continue;
    $kanji.append(`<div class="selectable">${known_kanji[i]}</div>`);
  }

  ds.addSelectables(document.querySelectorAll('#kanji .selectable'));
}

$(document).ready(kanji_grid);

function add_kanji(text, priority = false) {
  let known_kanji = new Set(localStorage.getItem(`known_${priority ? 'priority_' : ''}kanji`));
  // Regex to identify kanji
  let re = /[\u3005\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6A]/gu;
  for (let kanji of text.matchAll(re)) {
    if (priority && known_kanji.has(kanji[0])) known_kanji.delete(kanji[0]);
    else known_kanji.add(kanji[0]);
  }
  // Save updated kanji list to localStorage
  localStorage.setItem(`known_${priority ? 'priority_' : ''}kanji`, [...known_kanji].join(''));
  // Update kanji grid
  if (!priority) kanji_grid();
  // Add the kanji to the normal list as well
  if (priority) add_kanji(text);
}

const $new_kanji = $('#new_kanji');
const $new_priority_kanji = $('#new_priority_kanji');

// Add kanji
$('#add_kanji').submit(e => {
  e.preventDefault();
  add_kanji($new_kanji.val());
  // Reset the input field
  $new_kanji.val('');
});

// Add priority kanji
$('#add_priority_kanji').submit(e => {
  e.preventDefault();
  add_kanji($new_priority_kanji.val(), true);
  // Reset the input field
  $new_priority_kanji.val('');
});

// Copy kanji
$('#copy').on('click', () => {
  let text = '';
  $('#kanji div.selected').each(function () {
    text += this.innerText;
  });
  navigator.clipboard.writeText(text).then(function() {
    $('#copied').slideDown(() => {setTimeout(() => {$('#copied').slideUp()}, 2000)});
  }, function(err) {
    console.error('Async: Could not copy text: ', err);
  });
});

// Copy kanji from preview
$('#copy_from_preview').on('click', () => {
  let text = '';
  $('#preview_kanji div.selected').each(function () {
    text += this.innerText;
  });
  navigator.clipboard.writeText(text).then(function() {
    $('#copied').slideDown(() => {setTimeout(() => {$('#copied').slideUp()}, 2000)});
  }, function(err) {
    console.error('Async: Could not copy text: ', err);
  });
});

const $confirmation = $('#confirmation');

// Remove kanji
$('#remove').on('click', () => {
  $('#confirmation + .overlay').show();
  $confirmation.attr('data-grid', 'kanji').show('slow');
  $('#confirmation span').text(`the ${$('#kanji div.selected').length} selected`);
});

$('#remove_all').on('click', () => {
  $('#confirmation + .overlay').show();
  $confirmation.attr('data-grid', 'all').show('slow');
  let num_kanji = new Set(localStorage.getItem('known_kanji')).size;
  $('#confirmation span').text(`all ${num_kanji}`);
});

$('#confirmation button:last-child').on('click', () => {
  // Remove the selected kanji
  if ($confirmation.attr('data-grid') === 'all') {
    localStorage.removeItem('known_kanji');
    kanji_grid();
  } else if ($confirmation.attr('data-grid') === 'kanji') {
    let known_kanji = new Set(localStorage.getItem('known_kanji'));
    $('#kanji div.selected').each(function () {
      known_kanji.delete($(this).text());
    });
    // Save updated kanji list to localStorage
    localStorage.setItem('known_kanji', [...known_kanji].join(''));
    // Update kanji grid
    kanji_grid();
  } else {
    $('#preview_button_overlay').hide();
    $('#preview_kanji div.selected').remove();
    $('#num_preview').text($('#preview_kanji div').length);
  }
  // Hide the confirmation dialog
  $confirmation.hide('slow', () => $('#confirmation + .overlay').hide());
});

// Event handlers to close dialogs
$('dialog').each(function () {
  $(`#${this.id} .close, #${this.id} + .overlay`).on('click', () => {
    $(this).hide('slow', () => $(`#${this.id} + .overlay`).hide());
    if (this.id === 'preview') {
      // If the preview dialog was closed, reset the previewed kanji
      $preview_kanji.empty();
      $('#preview_button_overlay').hide();
    }
  });
});

// More options

$('#more_options > button').on('click', () => {
  $('#more_options > div').toggle();
  let text = $('#more_options > button').text().split(' ')[0];
  $('#more_options > button').text((text === 'More' ? 'Less' : 'More') + ' options');
});

$('.select button').on('click', function () {
  $(this).parent().parent().removeAttr('open');
  $(this)
    .parent()
    .siblings('summary')
    .text($(this).text())
    .attr('data-value', $(this).attr('data-value'));
});

// Import kanji
$('#' + $('#import_from summary').attr('data-value')).show();
$('#import_from button').on('click', function () {
  $('.import_option').hide();
  $('#' + this.dataset.value).show();
});

$('#wanikani input').prop('max', $('#wanikani .select summary').attr('data-value') === 'stages' ? '60' : '2055');
$('#wanikani .select button').on('click', function () {
  $('#wanikani input').prop('max', this.dataset.value === 'stages' ? '60' : '2055');
});

$('#rtk input').prop('max', $('#rtk .select summary').attr('data-value') === 'stages' ? '56' : '2200');
$('#rtk .select button').on('click', function () {
  $('#rtk input').prop('max', this.dataset.value === 'stages' ? '56' : '2200');
});

const $file = $('#file');

$file.siblings('div').text($file.val().split(/([\\/])/g).pop());
$file.change(function () {
  if ($file[0].files[0].size > 4194304) {
    $('#file').parent().attr('class', 'upload error');
    $('#anki button').prop('disabled', true);
  } else {
    $('#file').parent().attr('class', 'upload');
    $('#anki button').prop('disabled', false);
  }
  $(this).siblings('div').text(this.value.split(/([\\/])/g).pop());
});

const $preview = $('#preview');
const $preview_kanji = $('#preview_kanji');

function preview_kanji(kanji, method) {
  if (!kanji.length) {
    // No kanji were found
    $('#no_kanji_found + .overlay').show();
    $('#no_kanji_found').show('slow');
    return;
  }
  // Preview kanji

  // Show the preview dialog
  $('#preview + .overlay').show();
  $preview.show('slow');
  // Set the method as a data attribute - this is used for analytics once the kanji are added
  $preview.attr('data-method', method);
  // Remove any previously added selectables
  preview_ds.removeSelectables(document.querySelectorAll('#preview .selectable'));
  // Reset the grid
  $preview_kanji.empty();
  // Show the number of kanji added
  $('#num_preview').text(kanji.length);
  // Fill the kanji grid
  for (let i = 0; i < kanji.length; i++) {
    $preview_kanji.append(`<div class="selectable">${kanji[i]}</div>`);
  }
  preview_ds.addSelectables(document.querySelectorAll('#preview .selectable'));
}

$('#anki').submit(e => {
  e.preventDefault();
  $('#anki button').prop('disabled', true);
  let form_data = new FormData();
  form_data.append('only_learnt', $('#only_learnt').is(':checked'));
  if ($file[0].files[0].size > 4194304) {
    $file.parent().attr('class', 'upload error');
    return;
  } else {
    $file.parent().attr('class', 'upload');
  }
  form_data.append('file', $file[0].files[0]);

  $.ajax({
    url: '/import_anki',
    type: 'POST',
    data: form_data,
    processData: false,
    contentType: false,
  }).done(result => {
    // Enable the import button again
    $('#anki button').prop('disabled', false);
    preview_kanji(result, 'anki');
  }).fail(console.log);
});

$('#wanikani form:first-child').submit(e => {
  e.preventDefault();
  $('#wanikani button').prop('disabled', true);
  $.post('/import_wanikani_api', {value: $('#api_key').val().trim()}).done(result => {
    // Enable the import buttons again
    $('#wanikani button').prop('disabled', false);
    preview_kanji(result, 'wanikani');
  }).fail(error => {
    console.log(error);
    alert('An error occurred');
    $('#wanikani button').prop('disabled', false);
  });
});

$('#wanikani form:last-child').submit(e => {
  e.preventDefault();
  $('#wanikani button').prop('disabled', true);
  $.post('/import_wanikani', {
    number: $('#wanikani input:not(#api_key)').val(),
    method: $(`#wanikani summary`).attr('data-value'),
  }).done(result => {
    // Enable the import buttons again
    $('#wanikani button').prop('disabled', false);
    preview_kanji(result, 'wanikani');
  }).fail(error => {
    console.log(error);
    alert('An error occurred');
    $('#wanikani button').prop('disabled', false);
  });
});

$('.import_option:not(#anki):not(#wanikani)').submit(function (e) {
  e.preventDefault();
  $(this).children('button').prop('disabled', true);
  let number;
  if (this.id === 'rtk') {
    number = $(this).children('input').val();
  } else {
    number = $(`#${this.id} summary`).attr('data-value');
  }
  $.post(`/import_${this.id}`, {
    number: number,
    method: this.id === 'rtk' ? $(`#${this.id} summary`).attr('data-value') : 'stages',
  }).done(result => {
    // Enable the import button again
    $(this).children('button').prop('disabled', false);
    preview_kanji(result, this.id);
  }).fail(console.log);
});

$('#remove_from_preview').on('click', () => {
  $('#confirmation + .overlay').show();
  $confirmation.attr('data-grid', 'preview_kanji').show('slow');
  $('#confirmation span').text(`the ${$('#preview_kanji div.selected').length} selected`);
});

$('#preview button:last-child').on('click', () => {
  // Add the kanji
  add_kanji($preview_kanji.text());
  // Analytics
  if (typeof pa !== 'undefined') pa.track({name: `[${$preview.attr('data-method')}] kanji added`});
  $preview_kanji.empty();
  $('#preview_button_overlay').hide();
  $preview.hide('slow', () => $('#preview + .overlay').hide());
});

// Export kanji

function download(filename, text) {
  // Download a file
  let element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

$('#export').on('click', () => {
  let d = new Date();
  let filename = `sakubun_kanji_list_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}.txt`;
  download(filename, localStorage.getItem('known_kanji'));
});

$('#export_priority').on('click', () => {
  let d = new Date();
  let filename = `sakubun_priority_kanji_list_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}.txt`;
  download(filename, localStorage.getItem('known_priority_kanji'));
});
