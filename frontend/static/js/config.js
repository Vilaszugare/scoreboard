export const API_URL = "http://127.0.0.1:8000/api";
export const SOCKET_URL = "http://127.0.0.1:8000"; // For WebSocket connection
const urlParams = new URLSearchParams(window.location.search);
const mIdParam = urlParams.get('match_id');

export const MATCH_ID = mIdParam ? parseInt(mIdParam) : null;

// Menu Options Mapping
export const MENU_OPTIONS = {
    1: [
        { label: '1 Bat run', action: 'run', value: 1 },
        { label: '1 Bat run (declare)', action: 'run', value: 1, type: 'declare' },
        { label: '1 Bye run', action: 'bye', value: 1 },
        { label: '1 Leg-Bye run', action: 'leg-bye', value: 1 }
    ],
    2: [
        { label: '2 Bat runs', action: 'run', value: 2 },
        { label: '2 Bye runs', action: 'bye', value: 2 },
        { label: '2 Leg-Bye runs', action: 'leg-bye', value: 2 }
    ],
    3: [
        { label: '3 Bat runs', action: 'run', value: 3 },
        { label: '3 Bye runs', action: 'bye', value: 3 },
        { label: '3 Leg-Bye runs', action: 'leg-bye', value: 3 }
    ],
    4: [
        { label: 'FOUR (Boundary)', action: 'boundary', value: 4 },
        { label: '4 Bat runs (ran)', action: 'run', value: 4 },
        { label: '4 Bye runs', action: 'bye', value: 4 },
        { label: '4 Leg-Bye runs', action: 'leg-bye', value: 4 }
    ],
    5: [
        { label: '5 Bat runs', action: 'run', value: 5 },
        { label: '5 Bye runs', action: 'bye', value: 5 },
        { label: '5 Leg-Bye runs', action: 'leg-bye', value: 5 }
    ],
    6: [
        { label: 'SIX (Boundary)', action: 'boundary', value: 6 },
        { label: '6 Bat runs (ran)', action: 'run', value: 6 },
        { label: '6 Bye runs', action: 'bye', value: 6 },
        { label: '6 Leg-Bye runs', action: 'leg-bye', value: 6 }
    ],
    7: [
        { label: '7 Bat runs', action: 'run', value: 7 },
        { label: '7 Bye runs', action: 'bye', value: 7 },
        { label: '7 Leg-Bye runs', action: 'leg-bye', value: 7 }
    ]
};

export const ACTION_OPTIONS = {
    'Wide Ball': [
        { label: 'Wide', action: 'wide', value: 0 },
        { label: 'Wide + 1 run', action: 'wide', value: 1 },
        { label: 'Wide + 1 (declare)', action: 'wide', value: 1, type: 'declare' },
        { label: 'Wide + 2 runs', action: 'wide', value: 2 },
        { label: 'Wide + 3 runs', action: 'wide', value: 3 },
        { label: 'Wide + 4 runs', action: 'wide', value: 4 },
        { label: 'Wide + 5 runs', action: 'wide', value: 5 },
        { label: 'Wide + 6 runs', action: 'wide', value: 6 },
        { label: 'Wide + 7 runs', action: 'wide', value: 7 }
    ],
    'No Ball': [
        { label: 'No ball', action: 'noball', value: 0 },
        { label: 'No ball + 1', action: 'noball', value: 1 },
        { label: 'No ball + 2', action: 'noball', value: 2 },
        { label: 'No ball + 3', action: 'noball', value: 3 },
        { label: 'No ball + FOUR (Boundary)', action: 'noball', value: 4, type: 'boundary' },
        { label: 'No ball + 4', action: 'noball', value: 4 },
        { label: 'No ball + 5', action: 'noball', value: 5 },
        { label: 'No ball + SIX (Boundary)', action: 'noball', value: 6, type: 'boundary' },
        { label: 'No ball + 6', action: 'noball', value: 6 },
        { label: 'No ball + 7', action: 'noball', value: 7 }
    ],
    'Penalty': [
        ...Array.from({ length: 10 }, (_, i) => ({ label: `+${i + 1} run (Penalty)`, action: 'penalty', value: i + 1 })),
        ...Array.from({ length: 10 }, (_, i) => ({ label: `${-(i + 1)} run (Penalty)`, action: 'penalty', value: -(i + 1) }))
    ],
    'Stumped': [
        { label: 'Fair Delivery (Stumping)', action: 'wicket', value: 'stumped', type: 'fair' },
        { label: 'Wide Ball (Stumping)', action: 'wicket', value: 'stumped', type: 'wide' }
    ],
    'Hit-Wicket': [
        { label: 'Fair Delivery', action: 'wicket', value: 'hit_wicket', type: 'fair' },
        { label: 'Wide Ball', action: 'wicket', value: 'hit_wicket', type: 'wide' }
    ],
    'Runout': [
        { label: 'Runout while taking run', action: 'wicket', value: 'runout', type: 'standard' },
        { label: 'Mankad Wicket (Non Striker out)', action: 'wicket', value: 'runout', type: 'mankad' }
    ],
    'Other Wkt': [
        { label: 'Handled the ball', action: 'wicket', value: 'other', type: 'handled_ball' },
        { label: 'Hit ball twice', action: 'wicket', value: 'other', type: 'hit_twice' },
        { label: 'Obstructing the field', action: 'wicket', value: 'other', type: 'obstructing' }
    ]
};
