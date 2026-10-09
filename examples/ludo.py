import random
import time

class LudoGame:
    def __init__(self):
        self.players = {
            'Red': {'position': 0, 'finished': False},
            'Blue': {'position': 0, 'finished': False},
            'Green': {'position': 0, 'finished': False},
            'Yellow': {'position': 0, 'finished': False}
        }
        self.current_player = 'Red'
        self.board_size = 52
        
    def roll_dice(self):
        return random.randint(1, 6)
    
    def move_player(self, steps):
        if self.players[self.current_player]['finished']:
            return
            
        self.players[self.current_player]['position'] += steps
        
        if self.players[self.current_player]['position'] >= self.board_size:
            self.players[self.current_player]['position'] = self.board_size
            self.players[self.current_player]['finished'] = True
            print(f"{self.current_player} has finished the game!")
    
    def switch_player(self):
        players = list(self.players.keys())
        current_index = players.index(self.current_player)
        next_index = (current_index + 1) % len(players)
        self.current_player = players[next_index]
    
    def check_winner(self):
        finished_players = [p for p, data in self.players.items() if data['finished']]
        if len(finished_players) > 0:
            return finished_players[0]
        return None
    
    def play_turn(self):
        print(f"\n{self.current_player}'s turn")
        input("Press Enter to roll the dice...")
        
        dice = self.roll_dice()
        print(f"{self.current_player} rolled a {dice}")
        
        self.move_player(dice)
        print(f"{self.current_player} is now at position {self.players[self.current_player]['position']}")
        
        winner = self.check_winner()
        if winner:
            print(f"\n🎉 {winner} wins the game! 🎉")
            return True
            
        self.switch_player()
        return False
    
    def play(self):
        print("Welcome to Ludo!")
        print("Players: Red, Blue, Green, Yellow")
        
        while True:
            if self.play_turn():
                break
            time.sleep(1)

if __name__ == "__main__":
    game = LudoGame()
    game.play()