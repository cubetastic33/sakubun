if (localStorage.getItem('days_learnt') === null) {
  localStorage.setItem('days_learnt', JSON.stringify({}));
}

const DAY = 24 * 60 * 60 * 1000; // Number of milliseconds in one day

function numerify(date) {
  // Converts a date to a number
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function datify(number) {
  // Converts a number to a date
  return new Date(Math.floor(number / 10000), Math.floor(number % 10000 / 100) - 1, number % 100);
}

function draw_map(end_date, start_year=true) {
  // Draws the heatmap for 1 year before the end date
  end_date.setHours(0, 0, 0, 0); // Set time to midnight so calculations work as expected
  // Reset the current map
  $('.streak_day').css('background-color', 'var(--background-dark)');
  $('.empty').removeClass('empty');
  // Blank out the days after end_date
  for (let i = 0; i < 6 - end_date.getDay(); i++) $('.streak_day').eq(370 - i).addClass('empty');
  // If start_year is true, we start on Jan 1 and blank out the days before that
  // Otherwise we start on a Sunday
  const start_date = start_year ? new Date(end_date.getFullYear(), 0, 1) : new Date(end_date - (370 - (6 - end_date.getDay())) * DAY);
  start_date.setHours(0, 0, 0, 0); // Set time to midnight so calculations work as expected
  // Blank out the days before start_date
  for (let i = 0; i < start_date.getDay(); i++) $('.streak_day').eq(i).addClass('empty');
  
  const days_learnt = JSON.parse(localStorage.getItem('days_learnt'));
  const days = Object.keys(days_learnt).map(x => parseInt(x)).sort();

  function scale(x) {
    // Scales x to a percentage to use with HSL
    let min = Math.min(...Object.values(days_learnt));
    // Mellow the difference in color if there's very little variation between min and max
    min = Math.max(min - 10, 0);
    const max = Math.max(...Object.values(days_learnt)) + 10;
    return (100 - 35) * (x - min) / (max - min) + 35;
  }

  if (start_year) {
    $('#months span').eq(0).text('Jan');
    $('#months span').eq(1).text('Dec');
  }

  let longest_streak = 0;
  let current_streak = 0;

  for (let i = 0; i < days.length; i++) {
    // Streak length calculation
    // If the day before days[i] has questions done
    if (days_learnt[numerify(new Date(datify(days[i]) - DAY))] > 0) current_streak++;
    else {
      if (current_streak > longest_streak) longest_streak = current_streak;
      current_streak = 1;
    }

    // If this date is in the range that is displayed
    const date = datify(days[i]);
    if (date >= start_date && date <= end_date) {
      const num_questions = days_learnt[days[i]];
      $('.streak_day')
        .eq(Math.round((date - start_date) / DAY))
        .css('background-color', `hsl(335, 70%, ${scale(num_questions)}%)`)
        .prop('title', `${date.toDateString()} - ${num_questions} question${num_questions === 1 ? '' : 's'}`);
    }
  }

  const today = new Date();
  const learnt_today = days_learnt[numerify(today)] || 0;
  if (current_streak > longest_streak) longest_streak = current_streak;
  
  // If the user hasn't learnt today OR yesterday, set current_streak to 0
  if (!learnt_today > 0 && !days_learnt[numerify(new Date(today - DAY))] > 0) current_streak = 0;

  $('#longest').text(`${longest_streak} day${longest_streak === 1 ? '' : 's'}`);
  $('#current').text(`${current_streak} day${current_streak === 1 ? '' : 's'}`);
  $('#today').text(`${learnt_today} question${learnt_today === 1 ? '' : 's'}`);
}

draw_map(new Date(), false);

$('#next_year').on('click', () => {
  const current_year = $('#year').text();
  if (current_year === 'Past 1 year') {
    const year = new Date().getFullYear();
    draw_map(new Date(year, 11, 31));
    $('#year').text(year);
  } else {
    draw_map(new Date(parseInt(current_year) + 1, 11, 31));
    $('#year').text(parseInt(current_year) + 1);
  }
});

$('#prev_year').on('click', () => {
  const current_year = $('#year').text();
  if (current_year === 'Past 1 year') {
    const year = new Date().getFullYear() - 1;
    draw_map(new Date(year, 11, 31));
    $('#year').text(year);
  } else {
    draw_map(new Date(parseInt(current_year) - 1, 11, 31));
    $('#year').text(parseInt(current_year) - 1);
  }
});

// Import and export functionality

function download_json(filename, obj) {
  // Download a file
  let element = document.createElement('a');
  // Pretty-prints the JSON with 2 spaces as indents
  element.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(obj, null, 2)));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

$('#export_streaks').on('click', () => {
  let d = new Date();
  let filename = `sakubun_quiz_streaks_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}.json`;
  download_json(filename, JSON.parse(localStorage.getItem('days_learnt')));
});

$('#import_streaks').on('click', () => {
  $('#import_streaks_dialog + .overlay').show();
  $('#import_streaks_dialog').show('slow');
});

const $file = $('#file');

$file.siblings('div').text($file.val().split(/([\\/])/g).pop());
$file.change(async function () {
  $('#import_error').hide();
  $('#confirmation').hide();
  if (this.files[0].size > 4194304) {
    $file.parent().attr('class', 'upload error');
  } else {
    $file.parent().attr('class', 'upload');
    try {
      const contents = JSON.parse(await this.files[0].text());
      const num_days = Object.keys(contents).length;
      console.log(contents);
      $('#confirmation span').text(num_days + ' day' + (num_days === 1 ? '\'s' : 's\''));
      $('#confirmation').show();
    } catch (e) {
      console.log(e);
      $('#import_error').show();
    }
  }
  $(this).siblings('div').text(this.value.split(/([\\/])/g).pop());
});

$('#replace').on('click', async () => {
  const contents = JSON.parse(await $file[0].files[0].text());
  localStorage.setItem('days_learnt', JSON.stringify({ ...contents }));
  draw_map(new Date(), false);
  $('#import_streaks_dialog').hide('slow').then($('#import_streaks_dialog + .overlay').hide());
});

$('#merge').on('click', async () => {
  const contents = JSON.parse(await $file[0].files[0].text());
  const current = JSON.parse(localStorage.getItem('days_learnt')) || {};
  console.log('current', current);
  console.log('contents', contents);
  for (const day in contents) {
    console.log('day', day);
    if (current[day]) current[day] += contents[day];
    else current[day] = contents[day];
  }
  console.log('current', current);
  localStorage.setItem('days_learnt', JSON.stringify(current));
  draw_map(new Date(), false);
  $('#import_streaks_dialog').hide('slow').then($('#import_streaks_dialog + .overlay').hide());
});
