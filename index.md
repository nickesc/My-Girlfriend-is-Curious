# My Girlfriend is Curious
### about what I listen to on Spotify!

###### By [N. Escobar](https://nickesc.github.io)/[nickesc](https://nickesc.com)

My girlfriend wants to know what I'm listening to, so I wrote a small server and HTML tag using [`Spotify's API`](https://developer.spotify.com/documentation/web-api/) and [`thelinmichael/spotify-web-api-node`](https://github.com/thelinmichael/spotify-web-api-node) that will return and display my current listening activity.

The goal with the frontend was to create an HTML tag that could be copied dropped into any project, as it was with scripting and styling inline. I wanted something that I could transplant to any webpage I wanted, including (as you can see in the [demo](https://nickesc.github.io/My-Girlfriend-is-Curious/), it can even be dropped into Markdown without *too* much trouble)

The player shows the currently playing track and its metadata, the current position in the song, player options like shuffle and repeat, the playback device and links back to Spotify. If there is no song playing, it shows as "Offline." The player updates every five seconds, so it gives a near real-time view of what I'm listening to on Spotify.
<style>
.markdown-body img {
    background-color: #fff0;
}
</style>

<spotify style="position: fixed;">
    <div class = "spotifyPlayer" style="position: relative; display: flex; flex-direction: row; width: 100vw; max-width: 700px; min-width: 320px; font-family: 'Helvetica Neue', sans-serif; background-color: #191414;text-overflow: ellipsis;white-space: nowrap;overflow: hidden; ">
        <a href="https://open.spotify.com/user/goofyshnoofy" style="color: white; font-weight: bold; text-decoration: none"><div class = "spotifyStatusIndicator" style="position: absolute; right: min(1.5vmin,10px); top: min(1.5vmin,10px); background-color: #191414;text-align: center; padding: min(.7vmin,7px) min(1vmin,7px); font-size: clamp(10px, 1.5vw, 12px); min-width: 40px;max-width: 80px; border-radius: 10000px;" onMouseOver="this.style.backgroundColor='#191414'" onMouseOut="this.style.backgroundColor='#191414'">&nbsp;</div></a>
        <div class = "playerImgContainer" style="height: 130px;">
            <img class = "trackImg" src = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/missingAlbum.png" alt = "albumArt" style="height:130px;object-fit: cover">
        </div>
        <div class = 'playerControlsContainer' style=" display: flex; flex-direction: column; width: 100%">
            <div class = "trackInfoContainer" style="display: flex; flex-direction: column; height:65%; max-width: 100%; justify-content:center; padding-left: 2.5%;padding-right: 2.5%">
                <div class = "device" style="color: #535353; font-size: clamp(8px,1.5vw,15px);display: flex;align-items: center;"><div class = "deviceName">&nbsp;</div> <img class = "deviceImg" src = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/blank.png" alt="deviceImage" style="padding-left:3px;height:2ex;color: #535353"></div>
                <div class = "playerMiddle" style="display: flex; flex-direction: row; align-items: baseline; justify-content: left; width: 100%; margin: .3vh 0">
                    <a href = "" class = "trackName" style="text-decoration:none;font-size:clamp(8px,2vw,17px);text-overflow: clip;white-space: nowrap;overflow: hidden;width: fit-content;max-width:23ch;color: white; font-weight: bold;">...</a>
                    <div class = "trackBreak" style="font-size: clamp(8px,2vw,20px); color: #B3B3B3; padding: 0 5px">&nbsp;</div>
                    <a href = "" class = "trackContext" style="text-decoration:none; text-overflow: clip;white-space: nowrap;overflow: hidden;width: fit-content;max-width:47%;color: #B3B3B3; font-weight: normal;font-size: clamp(7px,1.5vw,15px)">&nbsp;</a>
                </div>
                <div style="display: flex; justify-content: space-between">
                    <a class = "trackArtist" style="font-size:clamp(8px,1.5vw,15px);color: #B3B3B3; font-weight: normal; text-decoration: none" href="">&nbsp;</a>
                    <div style="display: flex; flex-direction: row; justify-content: center; font-size: 15px" >
                        <img class = "shuffleImg" src = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/blank.png" alt="shuffleImage" style="padding-left:1vw;height:2ex;">
                        <img class = "repeatImg" src = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/blank.png" alt="repeatImage" style="padding-left:1vw;padding-right:1vw;height:2ex;">
                        <div class = "volumeLevel" style="margin:0 3px;height:1.8ex;background-color: #191414; width: .5vw; max-width: 4px; min-width: 3px;display: flex;justify-content: flex-end;flex-direction: column;"><div class="volumeFill" style="background-color: #B3B3B3; height:0%"></div></div>
                    </div>
                </div>
            </div>
            <div class="playerProgressContainer" style="height:10%; display: flex; flex-direction: row">
                <div style="width: 95%; height:30%; background-color: #535353; margin-left: auto; margin-right: auto"><div class = "innerProgress" style="width: 1%; height: 100%; background-color: #B3B3B3;"></div></div>
            </div>
            <a class="onSpotifyContainer" style="font-size: 17px;text-decoration:none;height: 25%; background-color: #191414;text-align: center; color: white; font-weight: bold; display: flex;justify-content: center;align-items: center;" onMouseOver="this.style.backgroundColor='#191414'" onMouseOut="this.style.backgroundColor='#191414'">
                <img src="https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/Spotify_Icon_RGB_White.png" style="min-height: 21px; height: 1em; padding-right: 2.5%" alt="Spotify Logo"><div class="listenOnText">&nbsp;</div>
            </a>
        </div>
    </div>
<script>
    const mediaQuery = window.matchMedia('(min-width: 760px)');
    let spotify = document.getElementsByTagName("spotify")[0];
    let trackImg = document.getElementsByClassName("trackImg")[0];
    let trackImgContainer = document.getElementsByClassName("playerImgContainer")[0];
    let listenOnContainer = document.getElementsByClassName("onSpotifyContainer")[0];
    function handleChange(e) {
        if (mediaQuery.matches) {
            spotify.style.right = "5%";
            spotify.style.bottom = "5%";
            trackImg.style.height = "130px";
            trackImgContainer.style.maxHeight = "130px";
            listenOnContainer.style.fontSize = "17px";
        }else {
            spotify.style.right = "0px";
            spotify.style.bottom = "0px";
            trackImg.style.height = "93px";
            trackImgContainer.style.maxHeight = "93px";
            listenOnContainer.style.fontSize = "13px";
        }
    }
    mediaQuery.addListener(handleChange);
    handleChange(mediaQuery);
    let x = 0;
    let currentSongUrl = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/demoSong.json";
    function setSong(){
                if(x===0){
                    currentSongUrl = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/demoSong.json"
                } else if(x===1){
                    currentSongUrl = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/demoPodcast.json"
                } else if(x===2){
                    currentSongUrl = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/demoOffline.json"
                }
                x++; if(x>2){x=0};
                fetch(currentSongUrl)
                .then (data => {return data.json()})
                .then (res => {
                    console.log(res);
                    let onlineStatus = document.getElementsByClassName("spotifyStatusIndicator")[0];
                    let listenOn = document.getElementsByClassName("onSpotifyContainer")[0];
                    let listenOnText = document.getElementsByClassName("listenOnText")[0];
                    let trackName = document.getElementsByClassName("trackName")[0];
                    let volBack = document.getElementsByClassName("volumeLevel")[0];
                    let trackContext = document.getElementsByClassName("trackContext")[0];
                    let trackBreak = document.getElementsByClassName("trackBreak")[0];
                    let deviceImg = document.getElementsByClassName("deviceImg")[0];
                    let deviceName = document.getElementsByClassName("deviceName")[0];
                    let artistName = document.getElementsByClassName("trackArtist")[0];
                    let progress = document.getElementsByClassName("innerProgress")[0];
                    let vol = document.getElementsByClassName("volumeFill")[0];
                    let shuffle = document.getElementsByClassName("shuffleImg")[0];
                    let repeat = document.getElementsByClassName("repeatImg")[0];
                    if(!res.playing) {
                        onlineStatus.innerHTML = "Offline";
                        onlineStatus.style.backgroundColor = "#d01616";
                        onlineStatus.onmouseover=function (){this.style.backgroundColor="#a21111"};
                        onlineStatus.onmouseout=function (){this.style.backgroundColor="#d01616"};
                        listenOnText.innerHTML = "Unable to connect";
                        trackName.innerHTML = "no track available";
                        trackName.removeAttribute("href");
                        trackContext.style.display = "none";
                        trackBreak.style.display = "none";
                        artistName.style.display = "none";
                        deviceName.style.display = "none";
                        deviceImg.style.display = "none";
                        shuffle.style.display = "none";
                        volBack.style.display = "none";
                        repeat.style.display = "none";
                        progress.style.width="1%";
                        listenOnContainer.style.backgroundColor = "#191414";
                        listenOnContainer.onmouseover=function (){this.style.backgroundColor="#191414"};
                        listenOnContainer.onmouseout=function (){this.style.backgroundColor="#191414"};
                        trackImg.src = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/missingAlbum.png";
                    } else{
                        artistName.style.display = "inline";
                        deviceName.style.display = "inline";
                        deviceImg.style.display = "inline";
                        shuffle.style.display = "inline";
                        volBack.style.display = "inline";
                        repeat.style.display = "inline";
                        volBack.style.backgroundColor = "#535353";
                        onlineStatus.innerHTML = "Online";
                        onlineStatus.style.backgroundColor = "#2E77D0";
                        onlineStatus.onmouseover=function (){this.style.backgroundColor="#235fa9"};
                        onlineStatus.onmouseout=function (){this.style.backgroundColor="#2E77D0"};
                        listenOn.style.backgroundColor = "#1DB954";
                        listenOnContainer.href = res.track.url;
                        listenOnText.innerHTML = "Listen on Spotify";
                        listenOnContainer.onmouseover=function (){this.style.backgroundColor="#169d46"};
                        listenOnContainer.onmouseout=function (){this.style.backgroundColor="#1DB954"};
                        trackName.innerHTML=res.track.name;
                        trackName.href = res.track.url;
                        if(res.track.context) {
                            trackBreak.innerHTML="-";
                            trackContext.style.display = "inline";
                            trackBreak.style.display = "inline";
                            trackContext.innerHTML = res.track.context.name;
                            trackContext.href = res.track.context.url;
                        } else{
                            trackName.style.maxWidth = "80%";
                            trackContext.innerHTML="";
                            trackBreak.style.display = "none";
                            trackBreak.style.display = "none";
                        }
                        if(res.device.type==="Smartphone"){
                            deviceImg.src = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/phoneIcon.png";
                        } else if(res.device.type==="Computer"){
                            deviceImg.src = "https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/compIcon.png";
                        }
                        deviceName.textContent=res.device.name;
                        let artists="";
                        for(let i = 0; i<res.track.artists.names.length; i++){
                            if(i===0) {
                                artists = res.track.artists.names[i]
                            } else{
                                artists = artists+ ", " + res.track.artists.names[i]
                            }
                        }
                        artistName.innerHTML=artists;
                        artistName.href = res.track.artists.url;
                        progress.style.width = String(res.player.progress * 100) + "%";
                        trackImg.src = res.track.image;
                        vol.style.height = String(res.player.vol)+"%";
                        if(res.player.shuffle === true) {
                            shuffle.src="https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/shuffleOn.png";
                        } else{
                            shuffle.src="https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/shuffleOff.png";
                        }
                        if(res.player.repeat === "off") {
                            repeat.src="https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/repeatOff.png";
                        } else{
                            repeat.src="https://raw.githubusercontent.com/nickesc/My-Girlfriend-is-Curious/main/img/repeatOn.png";
                        }
                    }
                    setTimeout(setSong, 10000);
                })
    }
    setSong();
</script>
</spotify>