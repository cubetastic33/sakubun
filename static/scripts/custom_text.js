// Initialize kuroshiro
var kuroshiro = new Kuroshiro();
kuroshiro.init(new KuromojiAnalyzer({dictPath: '/dict'}));

async function get_known_kanji() {
  const { data: {user} = {} } = await client.auth.getUser();
  if (user) {
    let { data } = await client.from('known_kanji').select('known_kanji').eq('user_id', user.id);
    return new Set(data.length ? data[0].known_kanji : []);
  } else return new Set(localStorage.getItem('known_kanji'));
}

function is_superset(set, subset) {
  for (let elem of subset) {
    if (!set.has(elem)) {
      return false;
    }
  }
  return true;
}

$('form').submit(async e => {
  e.preventDefault();
  const known_kanji = await get_known_kanji();
  const result = await kuroshiro.convert($('textarea').val(), {mode: 'furigana', to: 'hiragana'});
  $('#result').html(result.replaceAll('\n', '<br>'));

  $('ruby').each(function () {
    let word = new Set($(this).html().split('<rp>')[0]);
    if (is_superset(known_kanji, word)) {
      $(this).children().remove();
    }
  });
});
