function createProgressReporter(send) {
  return {
    update(payload) {
      send({
        type: 'progress',
        ...payload
      });
    },
    log(message) {
      send({
        type: 'log',
        message
      });
    },
    complete(outputs) {
      send({
        type: 'completed',
        outputs
      });
    },
    fail(error) {
      send({
        type: 'failed',
        error
      });
    }
  };
}

function createSubtitleLogger(progress) {
  return {
    info(message) {
      progress.log(message);
      const matchedItem = message.match(/matched item (\d+)\/(\d+)/i);

      if (matchedItem) {
        const current = Number(matchedItem[1]);
        const total = Number(matchedItem[2]);
        const percent = 60 + Math.round((current / total) * 25);
        progress.update({
          stage: 'mapping-subtitles',
          percent,
          message
        });
      }
    }
  };
}

function createVideoLogger(progress) {
  return {
    info(message) {
      progress.log(message);
      const cueMatch = message.match(/cue (\d+)\/(\d+)/i);

      if (cueMatch) {
        const current = Number(cueMatch[1]);
        const total = Number(cueMatch[2]);
        const percent = 50 + Math.round((current / total) * 40);
        progress.update({
          stage: 'generating-segments',
          percent,
          message
        });
      }
    }
  };
}

module.exports = {
  createProgressReporter,
  createSubtitleLogger,
  createVideoLogger
};
