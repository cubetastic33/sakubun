// Clear input
$("#answer").val("");
// Basic IME
wanakana.bind($("#answer")[0]);

// Get questions from the server
$.post("/sentences", result => {
    $("main").attr("data-sentences", result);
    $("main").attr("data-index", 0);
    $("#question").text(result.split(";")[0]);
});

$("form").submit(e => {
    e.preventDefault();
    let sentences = $("main").attr("data-sentences").split("|");
    let index = $("main").attr("data-index");
    if ($("#next").text() === "Show Answer") {
        // Show the answer
        let jap_sentence = sentences[index].split(";")[0];
        let eng_sentence = sentences[index].split(";")[1];
        $("#meaning").text(eng_sentence);
        $("#next").text("Next");
        // TODO check if answer was right
    } else {
        // Go to the next question
        index++;
        $("main").attr("data-index", index);
        $("#question").text(sentences[index].split(";")[0]);
        $("#meaning").empty();
        $("#answer").val("");
        $("#next").text("Show Answer");
    }
});

$("#answer").on("input", function () {
    this.parentNode.dataset.value = this.value;
});
