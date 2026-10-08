import { LICHESS } from "../common/constants";
import {
  addLoadingAnimation,
  waitForElementToExist,
  playButtonHandler,
} from "../common/chess_website_hook";
import { getDayStart, getActualWeekDayByDate } from "../common/date_utils";
import {
  getLichessGames,
  readLichessGamesResponseLines,
} from "../common/lichess_api";

// getting games only for last days, since we don't cache values in lichess

async function getLichessPlayerLastDayGamesTimes(
  items: ChessBlockerConfigType,
): Promise<number[]> {
  const username = items[(LICHESS + ".username") as UsernameConfigType]!;
  if (!username) {
    console.debug("ChessBlocker: no lichess.org username configured");
    return [];
  }

  const removeLoadingAnimation = addLoadingAnimation();

  const currentDate = new Date();
  const gamesLimitPerToday =
    items[(LICHESS + ".gamesPerDay") as GamesPerDayConfigType]![
      getActualWeekDayByDate(
        currentDate,
        items.dayStartTimeHours!,
        items.dayStartTimeMinutes!,
      )
    ];
  const dayStartDate = getDayStart(
    currentDate,
    items.dayStartTimeHours!,
    items.dayStartTimeMinutes!,
  );

  console.debug("ChessBlocker: fetching lichess.org games for " + username);
  const response = await getLichessGames(
    username,
    dayStartDate,
    gamesLimitPerToday,
  );
  console.debug("ChessBlocker: done fetching");

  const gameTimes: number[] = [];
  for await (const gameJsonText of readLichessGamesResponseLines(response)) {
    const gameJson: object = JSON.parse(gameJsonText);
    if (!("createdAt" in gameJson)) {
      console.warn("ChessBlocker: got lichess game without createdAt");
      continue;
    }

    gameTimes.push(parseInt(gameJson["createdAt"] as string));
  }
  console.debug("ChessBlocker: done parsing ndjson " + gameTimes.length);
  removeLoadingAnimation();

  return gameTimes;
}

function addListenersToPoolElements(parentElement: HTMLElement) {
  if (parentElement.classList.contains("lobby__app-pools")) {
    const poolElement = parentElement.querySelector(".lpools") as HTMLElement;
    if (!poolElement) {
      console.error("ChessBlocker: didnt find pool element in added node");
      return;
    }

    poolElement.addEventListener(
      "click",
      (event: MouseEvent) => {
        if (!(event.target instanceof Element)) {
          return;
        }

        const targetPoolButton = event.target.closest(
          "div[data-id]",
        ) as HTMLElement;
        if (
          targetPoolButton != null &&
          targetPoolButton.innerText != "Custom"
        ) {
          // click in one of the pool time controls
          playButtonHandler(
            event,
            LICHESS,
            false,
            getLichessPlayerLastDayGamesTimes,
          );
        }
      },
      true,
    );
  } else if (parentElement.classList.contains("lobby__app-real_time")) {
    parentElement.addEventListener(
      "click",
      (event: MouseEvent) => {
        if (!(event.target instanceof Element)) {
          return;
        }

        const targetChallengeRow = event.target.closest("tr.join");
        if (!targetChallengeRow) {
          return;
        }

        playButtonHandler(
          event,
          LICHESS,
          false,
          getLichessPlayerLastDayGamesTimes,
        );
      },
      true,
    );
  }
}

function installNewOpponentLimitCheck() {
  // Lichess draws this as <button class="new-opponent"> and then sets
  // location.href. The label is translated, so match the class.
  // Capture on document still sees the button after the game ends and the
  // controls are re-rendered.
  document.addEventListener(
    "click",
    (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      if (!event.target.closest("button.new-opponent")) {
        return;
      }

      playButtonHandler(
        event,
        LICHESS,
        true,
        getLichessPlayerLastDayGamesTimes,
      );
    },
    true,
  );
}

async function initializeChessBlocker() {
  installNewOpponentLimitCheck();

  const pagePath = document.location.pathname;
  if (pagePath == "/") {
    // home: quick pairing, Lobby

    // disallow again
    chrome.runtime.sendMessage(chrome.runtime.id, {
      type: "disallow-new-game-link",
      website: LICHESS,
    });

    // observing everything because the user can switch between quick pairing and lobby
    const poolMenuObserver = new MutationObserver((mutationList) => {
      for (const mutation of mutationList) {
        for (const addedNode of mutation.addedNodes) {
          if (!(addedNode instanceof Element)) {
            continue;
          }

          addListenersToPoolElements(addedNode as HTMLElement);
        }
      }
    });

    const lobbyElement = await waitForElementToExist(undefined, "main");
    if (!lobbyElement) {
      throw new Error("ChessBlocker: Didnt find lobby in home page");
    }

    // add listeners to existing elements before observing
    for (const child of lobbyElement.children) {
      addListenersToPoolElements(child as HTMLElement);
    }
    poolMenuObserver.observe(lobbyElement, { childList: true, subtree: false });

    // observe the opening og the "Game setup" dialog
    const createGameObserver = new MutationObserver((mutationList) => {
      for (const mutation of mutationList) {
        for (const addedNode of mutation.addedNodes) {
          if (!(addedNode instanceof Element)) {
            continue;
          }

          const createLobbyGameButton = addedNode.querySelector(
            "button.lobby__start__button",
          ) as HTMLElement;
          
          if (!createLobbyGameButton) {
            continue;
          }
          // opened a "Game setup" dialog

          createLobbyGameButton.addEventListener(
            "click",
            (event: ChessBlockerEvent) => {
              if (!(event.target instanceof Element)) {
                return;
              }

              playButtonHandler(
                event,
                LICHESS,
                false,
                getLichessPlayerLastDayGamesTimes,
              );
            },
            true,
          );
          console.debug("ChessBlocker: added listener to create lobby game button in dialog");
        }
      }
    });

    const lobbyTableElement = await waitForElementToExist(
      undefined,
      "div.lobby__table",
    );
    console.debug("ChessBlocker: start observing lobby table for create game dialog");
    createGameObserver.observe(lobbyTableElement, {
      childList: true,
      subtree: false,
    });
  }
}

console.debug("ChessBlocker initialize");
initializeChessBlocker();
console.debug("ChessBlocker done");
