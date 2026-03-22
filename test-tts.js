const { EdgeTTS } = require('edge-tts-node');
(async () => {
    const tts = new EdgeTTS()
    await tts.save('test.mp3', '¡Prueba 1,2,3 probando!', 'es-ES-AlvaroNeural');
    console.log("Audio created!");
})();
