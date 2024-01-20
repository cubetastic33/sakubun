if (localStorage.getItem('days_learnt') === null) {
  localStorage.setItem('days_learnt', JSON.stringify({}));
}

const DAY = 24 * 60 * 60 * 1000; // Number of milliseconds in one day
const days_learnt = JSON.parse(localStorage.getItem('days_learnt'));
const days = Object.keys(days_learnt).map(x => parseInt(x)).sort();

function numerify(date) {
  // Converts a date to a number
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function datify(number) {
  // Converts a number to a date
  return new Date(Math.floor(number / 10000), Math.floor(number % 10000 / 100) - 1, number % 100);
}

function scale(x) {
  // Scales x to a percentage between 40 and 90 for use with HSL
  const min = Math.min(...Object.values(days_learnt));
  const max = Math.max(...Object.values(days_learnt));
  if (min === max) return 60;
  return (90 - 40) * (x - min) / (max - min) + 40;
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
      if (current_streak + 1 > longest_streak) longest_streak = current_streak + 1;
      current_streak = 0;
    }
    prev = days_learnt[days[i]];

    // If this date is in the range that is displayed
    const date = datify(days[i]);
    if (date >= start_date && date <= end_date) {
      const num_questions = days_learnt[days[i]];
      $('.streak_day')
        .eq(Math.round((date - start_date) / DAY))
        .css('background-color', `hsl(335, 70%, ${scale(num_questions)}%)`)
        .prop('title', `${date.toLocaleDateString()} - ${num_questions} question${num_questions === 1 ? '' : 's'}`);
    }
  }

  const today = new Date();
  const learnt_today = days_learnt[numerify(today)] || 0;
  // If the user learnt today, add 1 to the current streak
  if (learnt_today === 0) current_streak = 0;
  else current_streak++;

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
