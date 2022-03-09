'use strict';

var spotifyApi = new SpotifyWebApi();
spotifyApi.getToken().then(function(response) {
  spotifyApi.setAccessToken(response.token);
});

var queryInput = document.querySelector('#query'),
    result = document.querySelector('#result'),
    text = document.querySelector('#text'),
    audioTag = document.querySelector('#audio'),
    playButton = document.querySelector('#play');

function updateProgressState() {
  if (audioTag.paused) {
    return;
  }
  var progressIndicator = document.querySelector('#progress');
  if (progressIndicator && audioTag.duration) {
    progressIndicator.setAttribute('x', (audioTag.currentTime * 100 / audioTag.duration) + '%');
  }
  requestAnimationFrame(updateProgressState);
}

audioTag.addEventListener('play', updateProgressState);
audioTag.addEventListener('playing', updateProgressState);

function updatePlayLabel() {
  playButton.innerHTML = audioTag.paused ? 'Play track' : 'Pause track';
}

audioTag.addEventListener('play', updatePlayLabel);
audioTag.addEventListener('playing', updatePlayLabel);
audioTag.addEventListener('pause', updatePlayLabel);
audioTag.addEventListener('ended', updatePlayLabel);

playButton.addEventListener('click', function() {
  if (audioTag.paused) {
    audioTag.play();
  } else {
    audioTag.pause();
  }
});

result.style.display = 'none';

function getPeaks(data) {
  var partSize = 22050,
      parts = data[0].length / partSize,
      peaks = [];

  for (var i = 0; i < parts; i++) {
    var max = 0;
    for (var j = i * partSize; j < (i + 1) * partSize; j++) {
      var volume = Math.max(Math.abs(data[0][j]), Math.abs(data[1][j]));
      if (!max || (volume > max.volume)) {
        max = {
          position: j,
          volume: volume
        };
      }
    }
    peaks.push(max);
  }
  peaks.sort(function(a, b) {
    return b.volume - a.volume;
  });
  peaks = peaks.splice(0, peaks.length * 0.5);
  peaks.sort(function(a, b) {
    return a.position - b.position;
  });

  return peaks;
}

function getIntervals(peaks) {
  var groups = [];

  peaks.forEach(function(peak, index) {
    for (var i = 1; (index + i) < peaks.length && i < 10; i++) {
      var group = {
        tempo: (60 * 44100) / (peaks[index + i].position - peak.position),
        count: 1
      };

      while (group.tempo < 90) {
        group.tempo *= 2;
      }

      while (group.tempo > 180) {
        group.tempo /= 2;
      }

      group.tempo = Math.round(group.tempo);

      if (!(groups.some(function(interval) {
        return (interval.tempo === group.tempo ? interval.count++ : 0);
      }))) {
        groups.push(group);
      }
    }
  });
  return groups;
}

$('#Tbpm').click(function(formEvent) {
  formEvent.preventDefault();
  result.style.display = 'none';
  spotifyApi.searchTracks(
    queryInput.value.trim(), {limit: 1})
    .then(function(results) {
      var track = results.tracks.items[0];
    if (track == null){
    Swal.fire('Error', 'No Matching Found!.<p class="text-center">Enter Track & Artist Name Correctly!.</p>', 'error')
    }
      var previewUrl = track.preview_url;
      audioTag.src = track.preview_url;
    
      var request = new XMLHttpRequest();
      request.open('GET', previewUrl, true);
      request.responseType = 'arraybuffer';
      request.onload = function() {
       
        var OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        var offlineContext = new OfflineContext(2, 30 * 44100, 44100);

        offlineContext.decodeAudioData(request.response, function(buffer) {

          var source = offlineContext.createBufferSource();
          source.buffer = buffer;
          var lowpass = offlineContext.createBiquadFilter();
          lowpass.type = "lowpass";
          lowpass.frequency.value = 150;
          lowpass.Q.value = 1;
          source.connect(lowpass);
          var highpass = offlineContext.createBiquadFilter();
          highpass.type = "highpass";
          highpass.frequency.value = 100;
          highpass.Q.value = 1;
          lowpass.connect(highpass);
          highpass.connect(offlineContext.destination);
          source.start(0);
          offlineContext.startRendering();
        });

        offlineContext.oncomplete = function(e) {
          var buffer = e.renderedBuffer;
          var peaks = getPeaks([buffer.getChannelData(0), buffer.getChannelData(1)]);
          var groups = getIntervals(peaks);

          var svg = document.querySelector('#svg');
          svg.innerHTML = '';
          var svgNS = 'http://www.w3.org/2000/svg';
          var rect;
          peaks.forEach(function(peak) {
            rect = document.createElementNS(svgNS, 'rect');
            rect.setAttributeNS(null, 'x', (100 * peak.position / buffer.length) + '%');
            rect.setAttributeNS(null, 'y', 0);
            rect.setAttributeNS(null, 'width', 1);
            rect.setAttributeNS(null, 'height', '100%');
            svg.appendChild(rect);
          });

          rect = document.createElementNS(svgNS, 'rect');
          rect.setAttributeNS(null, 'id', 'progress');
          rect.setAttributeNS(null, 'y', 0);
          rect.setAttributeNS(null, 'width', 1);
          rect.setAttributeNS(null, 'height', '100%');
          svg.appendChild(rect);

          svg.innerHTML = svg.innerHTML;

          var top = groups.sort(function(intA, intB) {
            return intB.count - intA.count;
          }).splice(0, 5);

          text.innerHTML = '<div id="guess">Guess for track <h5 style="color:#3cc7ba;">' + track.name + '</h5> by ' +
            '<h5 style="color:#6e76fc;">' + track.artists[0].name + '</h5> is <h5 style="color:#f933f8;">' + Math.round(top[0].tempo) + ' BPM</h5>' +
            ' with ' + top[0].count + ' samples.</div>';

          text.innerHTML += '<div class="small">Other options are ' +
            top.slice(1).map(function(group) {
              return group.tempo + ' BPM (' + group.count + ')';
            }).join(', ') +
            '</div>';

          var printENBPM = function(tempo) {
            text.innerHTML += '<div class="small">The tempo according to Spotify is ' +
                  tempo + ' BPM</div>';
          };
          spotifyApi.getAudioFeaturesForTrack(track.id)
            .then(function(audioFeatures) {
              printENBPM(audioFeatures.tempo);
            });

          result.style.display = 'block';
        };
      };
      request.send();
    });
});
